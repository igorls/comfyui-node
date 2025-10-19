import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import { ComfyApi, Workflow, WorkflowPool } from "../../src/index.js";
import BaseWorkflow from "../QwenImageEdit2509.json" assert { type: "json" };

interface ClientMessage {
    type: string;
    prompt?: string;
    image?: string;
    mimeType?: string;
}

interface SessionState {
    id: string;
    socket: WebSocket;
    prompt: string;
    paused: boolean;
    awaitingJob: boolean;
    latestImage?: Buffer;
    latestMimeType?: string;
    currentJobId?: string;
}

const PORT = Number(process.env.DEMO_PORT || 9000);
const COMFY_HOSTS: string[] = [];

// COMFY_HOSTS.push(...(process.env.COMFY_HOSTS || process.env.COMFY_HOST || "http://127.0.0.1:8188").split(",").map((h) => h.trim()).filter(Boolean));

const DEMO_DIR = path.dirname(fileURLToPath(import.meta.url));

COMFY_HOSTS.push("http://127.0.0.1:8188");
// COMFY_HOSTS.push("http://192.168.1.3:10888");

async function loadClients() {
    const clients: ComfyApi[] = [];
    for (const host of COMFY_HOSTS) {
        const api = await new ComfyApi(host).ready();
        clients.push(api);
    }
    if (clients.length === 0) {
        throw new Error("No ComfyUI hosts configured. Set COMFY_HOST or COMFY_HOSTS.");
    }
    return clients;
}

const sessions = new Map<string, SessionState>();
const jobToSession = new Map<string, string>();

let pool: WorkflowPool;
const clientMap = new Map<string, ComfyApi>();

function serveStatic(req: any, res: any) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let filePath: string;
    switch (url.pathname) {
        case "/":
            filePath = path.join(DEMO_DIR, "client.html");
            break;
        case "/client.js":
            filePath = path.join(DEMO_DIR, "client.js");
            break;
        default:
            res.writeHead(404);
            res.end();
            return;
    }
    readFile(filePath)
        .then((data) => {
            const ext = path.extname(filePath);
            const contentType = ext === ".js" ? "text/javascript" : "text/html";
            res.writeHead(200, { "Content-Type": contentType });
            res.end(data);
        })
        .catch(() => {
            res.writeHead(404);
            res.end();
        });
}

function broadcastProgress(jobId: string, value: number, max: number) {
    const sessionId = jobToSession.get(jobId);
    if (!sessionId) return;
    const session = sessions.get(sessionId);
    if (!session) return;
    session.socket.send(JSON.stringify({ type: "progress", jobId, value, max }));
}

async function fetchImageBuffer(client: ComfyApi | undefined, filename: string, subfolder?: string) {
    if (!client) {
        throw new Error("Client not available for image fetch");
    }
    const params = new URLSearchParams({ filename, type: "output" });
    if (subfolder) params.set("subfolder", subfolder);
    const url = new URL(`/view?${params.toString()}`, client.apiHost);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch image ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

function sendError(session: SessionState, message: string, detail?: unknown) {
    session.socket.send(JSON.stringify({ type: "error", message, detail }));
}

function decodeImagePayload(payload: string): { buffer: Buffer; mimeType: string } {
    if (payload.startsWith("data:")) {
        const [header, base64] = payload.split(",", 2);
        const mimeMatch = header.match(/data:(.*);base64/);
        const mime = mimeMatch?.[1] ?? "image/png";
        return { buffer: Buffer.from(base64, "base64"), mimeType: mime };
    }
    return { buffer: Buffer.from(payload, "base64"), mimeType: "image/png" };
}

async function scheduleJob(session: SessionState) {
    if (session.paused || session.awaitingJob || !session.latestImage) {
        return;
    }
    session.awaitingJob = true;
    try {
        const wf = Workflow.from(BaseWorkflow)
            .set("3.inputs.prompt", session.prompt || BaseWorkflow["3"].inputs.prompt)
            .output("images", "9");

        const filename = `${session.id}-${Date.now()}.png`;
        const blob = new Blob([new Uint8Array(session.latestImage)], {
            type: session.latestMimeType || "image/png"
        });

        await Promise.all(
            Array.from(clientMap.values()).map((client) =>
                client.ext.file.uploadImage(blob, filename, { override: true })
            )
        );

        wf.set("4.inputs.image", filename);

        const jobId = await pool.enqueue(wf, {
            includeOutputs: ["9"],
            metadata: { sessionId: session.id }
        });

        session.currentJobId = jobId;
        jobToSession.set(jobId, session.id);
        session.socket.send(JSON.stringify({ type: "queued", jobId }));
    } catch (error) {
        session.awaitingJob = false;
        sendError(session, "Failed to enqueue job", (error as Error).message);
    }
}

async function handleCompleted(jobId: string, job: any) {
    const sessionId = jobToSession.get(jobId);
    if (!sessionId) return;
    const session = sessions.get(sessionId);
    if (!session) return;
    session.awaitingJob = false;
    session.currentJobId = undefined;
    jobToSession.delete(jobId);
    if (!job.result?.images) {
        sendError(session, "Job completed without images");
        return;
    }

    const imagesPayload = Array.isArray(job.result.images) ? job.result.images : [job.result.images];
    const first = imagesPayload[0];
    let buffer: Buffer | undefined;
    let mimeType = session.latestMimeType || "image/png";

    if (first?.images?.[0]?.image) {
        const inner = first.images[0];
        const base64 = inner.image;
        buffer = Buffer.from(base64, "base64");
        mimeType = inner.mime_type || mimeType;
    } else if (first?.image) {
        buffer = Buffer.from(first.image, "base64");
        mimeType = first.mime_type || mimeType;
    } else if (first?.filename) {
        const client = job.clientId ? clientMap.get(job.clientId) : clientMap.values().next().value;
        buffer = await fetchImageBuffer(client, first.filename, first.subfolder);
        mimeType = "image/png";
    }

    if (!buffer) {
        sendError(session, "Could not extract image output");
        return;
    }

    session.latestImage = buffer;
    session.latestMimeType = mimeType;

    const base64 = buffer.toString("base64");
    session.socket.send(
        JSON.stringify({
            type: "image",
            jobId,
            prompt: session.prompt,
            dataUrl: `data:${mimeType};base64,${base64}`
        })
    );

    if (!session.paused) {
        await scheduleJob(session);
    }
}

function handleFailed(jobId: string, job: any, willRetry: boolean) {
    const sessionId = jobToSession.get(jobId);
    if (!sessionId) return;
    const session = sessions.get(sessionId);
    if (!session) return;
    session.awaitingJob = false;
    session.currentJobId = undefined;
    jobToSession.delete(jobId);
    sendError(session, "Job failed", job.lastError);
    if (!willRetry && !session.paused) {
        setTimeout(() => {
            void scheduleJob(session);
        }, 1000);
    }
}

async function main() {
    const clients = await loadClients();
    for (const client of clients) {
        clientMap.set(client.id, client);
    }
    pool = new WorkflowPool(clients);
    await pool.ready();

    pool.on("job:progress", (ev) => {
        broadcastProgress(ev.detail.jobId, ev.detail.progress.value, ev.detail.progress.max);
    });

    pool.on("job:completed", (ev) => {
        handleCompleted(ev.detail.job.jobId, ev.detail.job).catch((error) => {
            console.error("Failed processing completed job", error);
        });
    });
    pool.on("job:failed", (ev) => {
        handleFailed(ev.detail.job.jobId, ev.detail.job, ev.detail.willRetry);
    });

    const server = createServer(serveStatic);
    const wss = new WebSocketServer({ server });

    wss.on("connection", (socket) => {
        const sessionId = randomUUID();
        const session: SessionState = {
            id: sessionId,
            socket,
            prompt: "change her t-shirt color to red",
            paused: true,
            awaitingJob: false
        };
        sessions.set(sessionId, session);

        socket.send(JSON.stringify({ type: "ready", sessionId }));

        socket.on("message", async (data) => {
            try {
                const msg: ClientMessage = JSON.parse(data.toString());
                switch (msg.type) {
                    case "start": {
                        if (!msg.image) {
                            sendError(session, "Image is required");
                            break;
                        }
                        session.prompt = msg.prompt || session.prompt;
                        const { buffer, mimeType } = decodeImagePayload(msg.image);
                        session.latestImage = buffer;
                        session.latestMimeType = msg.mimeType || mimeType;
                        session.paused = false;
                        session.awaitingJob = false;
                        session.socket.send(JSON.stringify({ type: "state", paused: false }));
                        void scheduleJob(session);
                        break;
                    }
                    case "update_prompt": {
                        session.prompt = msg.prompt ?? session.prompt;
                        session.socket.send(JSON.stringify({ type: "prompt", prompt: session.prompt }));
                        break;
                    }
                    case "pause": {
                        session.paused = true;
                        session.socket.send(JSON.stringify({ type: "state", paused: true }));
                        break;
                    }
                    case "resume": {
                        session.paused = false;
                        session.socket.send(JSON.stringify({ type: "state", paused: false }));
                        void scheduleJob(session);
                        break;
                    }
                    default:
                        sendError(session, `Unknown message type: ${msg.type}`);
                }
            } catch (error) {
                sendError(session, "Invalid message", (error as Error).message);
            }
        });

        socket.on("close", () => {
            sessions.delete(sessionId);
        });
    });

    server.listen(PORT, () => {
        console.log(`Recursive edit demo server listening on http://localhost:${PORT}`);
    });
}

main().catch((err) => {
    console.error("Failed to start demo server", err);
    process.exit(1);
});
