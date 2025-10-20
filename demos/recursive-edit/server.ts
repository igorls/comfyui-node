import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import { ComfyApi, Workflow, WorkflowPool } from "../../src/index.js";
import BaseWorkflow from "../QwenImageEdit2509V2.json" assert { type: "json" };

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

interface HostStats {
    host: string;
    dispatched: number;
    running: number;
    completed: number;
    failed: number;
    totalQueueMs: number;
    totalRunMs: number;
    queueSamples: number;
    runSamples: number;
    lastQueueMs?: number;
    lastRunMs?: number;
}

const clientStats = new Map<string, HostStats>();
const completionTimestamps: number[] = [];
const STATS_LOG_INTERVAL_MS = 10_000;
let lastStatsLog = 0;

type StatsTrigger = "started" | "completed" | "failed" | "interval";

interface QueueState {
    waiting: number;
    active: number;
    totalQueued: number;
}

const queueState: QueueState = {
    waiting: 0,
    active: 0,
    totalQueued: 0
};

function formatDuration(ms?: number) {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return undefined;
    return ms;
}

function formatDurationDisplay(ms?: number | null) {
    if (ms == null) return "n/a";
    if (!Number.isFinite(ms) || ms < 0) return "n/a";
    if (ms >= 10_000) return `${Math.round(ms / 1000)}s`;
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.round(ms)}ms`;
}

function pruneCompletionHistory(now: number) {
    const cutoff = now - 60_000;
    while (completionTimestamps.length && completionTimestamps[0] < cutoff) {
        completionTimestamps.shift();
    }
}

function computeThroughput(now: number): number {
    pruneCompletionHistory(now);
    return completionTimestamps.length;
}

function formatHostLabel(raw: string): string {
    if (!raw) return "unknown";
    try {
        const parsed = new URL(raw);
        return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
    } catch {
        return raw;
    }
}

function getStatsSnapshot() {
    const snapshot = [] as Array<{
        clientId: string;
        host: string;
        dispatched: number;
        running: number;
        completed: number;
        failed: number;
        avgQueueMs: number | null;
        avgRunMs: number | null;
        lastQueueMs: number | null;
        lastRunMs: number | null;
    }>;
    for (const [clientId, stats] of clientStats.entries()) {
        const avgQueueMs = stats.queueSamples ? stats.totalQueueMs / stats.queueSamples : null;
        const avgRunMs = stats.runSamples ? stats.totalRunMs / stats.runSamples : null;
        snapshot.push({
            clientId,
            host: stats.host,
            dispatched: stats.dispatched,
            running: stats.running,
            completed: stats.completed,
            failed: stats.failed,
            avgQueueMs,
            avgRunMs,
            lastQueueMs: stats.lastQueueMs ?? null,
            lastRunMs: stats.lastRunMs ?? null
        });
    }
    snapshot.sort((a, b) => a.host.localeCompare(b.host));
    return snapshot;
}

function getQueueSnapshot() {
    return {
        waiting: Math.max(0, queueState.waiting),
        active: Math.max(0, queueState.active),
        totalQueued: Math.max(0, queueState.totalQueued)
    };
}

function broadcastStats() {
    if (sessions.size === 0) return;
    const payload = JSON.stringify({ type: "stats", hosts: getStatsSnapshot(), queue: getQueueSnapshot() });
    for (const session of sessions.values()) {
        if (session.socket.readyState === 1) {
            session.socket.send(payload);
        }
    }
}

function recordJobStarted(job: any) {
    const clientId = job?.clientId;
    if (!clientId) return;
    const stats = clientStats.get(clientId);
    if (!stats) return;
    stats.dispatched += 1;
    stats.running += 1;
    if (queueState.waiting > 0) {
        queueState.waiting -= 1;
    }
    queueState.active += 1;
    const startedAt = typeof job?.startedAt === "number" ? job.startedAt : undefined;
    const enqueuedAt = typeof job?.enqueuedAt === "number" ? job.enqueuedAt : undefined;
    if (startedAt != null && enqueuedAt != null) {
        const waitMs = formatDuration(startedAt - enqueuedAt);
        if (waitMs != null) {
            stats.queueSamples += 1;
            stats.totalQueueMs += waitMs;
            stats.lastQueueMs = waitMs;
        }
    }
    broadcastStats();
    maybeLogOverallStats("started", { force: true });
}

function recordJobFinished(job: any, outcome: "completed" | "failed") {
    const clientId = job?.clientId;
    if (!clientId) return;
    const stats = clientStats.get(clientId);
    if (!stats) return;
    stats.running = Math.max(0, stats.running - 1);
    queueState.active = Math.max(0, queueState.active - 1);
    if (outcome === "completed") {
        stats.completed += 1;
        const now = Date.now();
        completionTimestamps.push(now);
        pruneCompletionHistory(now);
    } else {
        stats.failed += 1;
    }
    const now = Date.now();
    const startedAt = typeof job?.startedAt === "number" ? job.startedAt : undefined;
    const completedAt = typeof job?.completedAt === "number" ? job.completedAt : undefined;
    const duration = startedAt != null ? (completedAt != null ? completedAt - startedAt : now - startedAt) : undefined;
    const runMs = formatDuration(duration);
    if (runMs != null) {
        stats.runSamples += 1;
        stats.totalRunMs += runMs;
        stats.lastRunMs = runMs;
    }
    broadcastStats();
    maybeLogOverallStats(outcome, { force: outcome === "failed" });
}

function recordJobQueued(job: any) {
    queueState.waiting += 1;
    queueState.totalQueued += 1;
    broadcastStats();
}

function logOverallStats(trigger: StatsTrigger = "interval") {
    const now = Date.now();
    const throughput = computeThroughput(now);
    const snapshot = getStatsSnapshot();
    const queue = getQueueSnapshot();
    let totalRunning = 0;
    let totalCompleted = 0;
    let totalFailed = 0;
    for (const host of snapshot) {
        totalRunning += host.running || 0;
        totalCompleted += host.completed || 0;
        totalFailed += host.failed || 0;
    }
    const hostLines = snapshot
        .map((host) => `${formatHostLabel(host.host)} · active ${host.running} · done ${host.completed} · fail ${host.failed} · avg ${formatDurationDisplay(host.avgRunMs)}`)
        .join(" | ");
    console.log(
        `[stats] ${trigger} → throughput ${throughput.toFixed(1)} img/min · queue ${queue.waiting} · active ${totalRunning} · completed ${totalCompleted} · failed ${totalFailed}`
    );
    if (hostLines) {
        console.log(`        hosts: ${hostLines}`);
    }
    lastStatsLog = now;
}

function maybeLogOverallStats(trigger: StatsTrigger, opts: { force?: boolean } = {}) {
    const now = Date.now();
    if (opts.force || lastStatsLog === 0 || now - lastStatsLog >= STATS_LOG_INTERVAL_MS) {
        logOverallStats(trigger);
    }
}

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

async function fetchImageBuffer(client: ComfyApi | undefined, filename: string, subfolder?: string, type: string = "output") {
    if (!client) {
        throw new Error("Client not available for image fetch");
    }
    const params = new URLSearchParams({ filename, type });
    if (subfolder) params.set("subfolder", subfolder);
    const url = new URL(`/api/view?${params.toString()}`, client.apiHost);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch image ${response.status}: ${response.statusText}`);
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
            .set("11.inputs.text", session.prompt || BaseWorkflow["11"].inputs.text)
            .set("2.inputs.seed", -1)
            .output("images", "12");

        const jobId = await pool.enqueue(wf, {
            includeOutputs: ["12"],
            metadata: { sessionId: session.id },
            attachments: [
                {
                    nodeId: "4",
                    inputName: "image",
                    file: session.latestImage,
                },
            ],
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
        console.error("[handleCompleted] Missing images in result. Available keys:", Object.keys(job.result || {}));
        sendError(session, "Job completed without images");
        return;
    }

    let buffer: Buffer | undefined;
    let mimeType = session.latestMimeType || "image/png";
    const images = job.result.images;

    // PreviewImage format: { images: [{ filename, subfolder, type }] }
    if (images && typeof images === "object" && !Buffer.isBuffer(images) && !Array.isArray(images)) {
        const nestedImages = (images as any).images;
        if (Array.isArray(nestedImages) && nestedImages.length > 0) {
            const imageInfo = nestedImages[0];
            
            if (imageInfo?.filename) {
                const client = job.clientId ? clientMap.get(job.clientId) : clientMap.values().next().value;
                if (!client) {
                    sendError(session, "No client available to fetch image");
                    return;
                }
                
                try {
                    buffer = await fetchImageBuffer(client, imageInfo.filename, imageInfo.subfolder, imageInfo.type);
                    mimeType = "image/png";
                } catch (error) {
                    console.error("[handleCompleted] Failed to fetch image:", (error as Error).message);
                    sendError(session, "Failed to fetch image from server", (error as Error).message);
                    return;
                }
            }
        }
    } else if (Array.isArray(images) && images.length > 0) {
        const first = images[0];
        
        // PreviewImage format: { filename: "ComfyUI_temp_xxx.png", subfolder: "", type: "temp" }
        if (first?.filename) {
            const client = job.clientId ? clientMap.get(job.clientId) : clientMap.values().next().value;
            if (!client) {
                sendError(session, "No client available to fetch image");
                return;
            }
            
            try {
                buffer = await fetchImageBuffer(client, first.filename, first.subfolder, first.type);
                mimeType = "image/png";
            } catch (error) {
                console.error("[handleCompleted] Failed to fetch image:", error);
                sendError(session, "Failed to fetch image from server", (error as Error).message);
                return;
            }
        } else if (first?.images?.[0]?.filename) {
            // SaveImage nested format
            const imageInfo = first.images[0];
            const client = job.clientId ? clientMap.get(job.clientId) : clientMap.values().next().value;
            buffer = await fetchImageBuffer(client, imageInfo.filename, imageInfo.subfolder, imageInfo.type);
            mimeType = "image/png";
        } else if (first?.image) {
            // Direct base64 preview format
            buffer = Buffer.from(first.image, "base64");
            mimeType = first.mime_type || mimeType;
        }
    } else if (Buffer.isBuffer(images)) {
        buffer = images;
        mimeType = "image/png";
    } else if (typeof images === "string") {
        // Base64 encoded image
        const { buffer: buf, mimeType: mime } = decodeImagePayload(images);
        buffer = buf;
        mimeType = mime;
    }

    if (!buffer) {
        sendError(session, "Could not extract image output");
        return;
    }

    session.latestImage = buffer;
    session.latestMimeType = mimeType;

    const base64 = buffer.toString("base64");
    const autoSeeds = job?.result?._autoSeeds;
    const seedValue = typeof autoSeeds?.["2"] === "number" ? autoSeeds["2"] : undefined;
    session.socket.send(
        JSON.stringify({
            type: "image",
            jobId,
            prompt: session.prompt,
            seed: seedValue,
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
    
    console.error("[handleFailed] Job failed:", {
        jobId,
        willRetry,
        error: job.lastError,
        attempts: job.attempts
    });
    
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
        clientStats.set(client.id, {
            host: client.apiHost,
            dispatched: 0,
            running: 0,
            completed: 0,
            failed: 0,
            totalQueueMs: 0,
            totalRunMs: 0,
            queueSamples: 0,
            runSamples: 0
        });
    }
    pool = new WorkflowPool(clients);
    await pool.ready();
    broadcastStats();
    const statsInterval = setInterval(() => {
        maybeLogOverallStats("interval", { force: true });
    }, STATS_LOG_INTERVAL_MS);
    (statsInterval as any)?.unref?.();

    pool.on("job:queued", (ev) => {
        recordJobQueued(ev.detail.job);
    });
    pool.on("job:started", (ev) => {
        recordJobStarted(ev.detail.job);
    });
    pool.on("job:progress", (ev) => {
        broadcastProgress(ev.detail.jobId, ev.detail.progress.value, ev.detail.progress.max);
    });

    pool.on("job:preview", async (ev) => {
        const sessionId = jobToSession.get(ev.detail.jobId);
        if (!sessionId) return;
        const session = sessions.get(sessionId);
        if (!session) return;

        const blob = ev.detail.blob;
        const buffer = Buffer.from(await blob.arrayBuffer());
        const base64 = buffer.toString("base64");
        
        session.socket.send(JSON.stringify({
            type: "image_preview",
            jobId: ev.detail.jobId,
            dataUrl: `data:image/png;base64,${base64}`
        }));
    });

    pool.on("job:completed", (ev) => {
        recordJobFinished(ev.detail.job, "completed");
        handleCompleted(ev.detail.job.jobId, ev.detail.job).catch((error) => {
            console.error("Failed processing completed job", error);
        });
    });
    pool.on("job:failed", (ev) => {
        recordJobFinished(ev.detail.job, "failed");
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
        socket.send(JSON.stringify({ type: "stats", hosts: getStatsSnapshot(), queue: getQueueSnapshot() }));

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
