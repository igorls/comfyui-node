import { JobRecord, SmartPool } from "../src/index.ts";
import { hashWorkflow } from "../src/pool/utils/hash.ts";
import { log, nextSeed, pickRandom, randomInt, uploadImage } from "./simulator/helpers.ts";
import { buildEditWorkflow, buildGenerationWorkflow } from "./simulator/workflows.ts";
import GenerationGraph from "./workflows/T2I-anime-nova-xl.json" assert { type: "json" };
import EditGraph from "./workflows/quick-edit-test.json" assert { type: "json" };

const DEFAULT_HOSTS = [
    "http://afterpic-comfy-igor:8188",
    "http://afterpic-comfy-aero16:8188",
    "http://afterpic-comfy-domi:8188",
    "http://afterpic-comfy-patrick:8188"
];

const GEN_HOST = "http://afterpic-comfy-aero16:8188";

const EDIT_HOSTS = [
    "http://afterpic-comfy-igor:8188",
    "http://afterpic-comfy-domi:8188",
    "http://afterpic-comfy-patrick:8188"
];

const hosts = process.env.TWO_STAGE_HOSTS
    ? process.env.TWO_STAGE_HOSTS.split(",")
        .map((h) => h.trim())
        .filter(Boolean)
    : DEFAULT_HOSTS;

if (hosts.length === 0) {
    console.error("No hosts configured. Provide TWO_STAGE_HOSTS or ensure defaults are reachable.");
    process.exit(1);
}

const runtimeMs = Number.isFinite(Number(process.env.TWO_STAGE_RUNTIME_MS))
    ? Number(process.env.TWO_STAGE_RUNTIME_MS)
    : 1 * 60 * 60 * 1000; // 1 hour

let minDelayMs = Number.isFinite(Number(process.env.TWO_STAGE_MIN_DELAY_MS))
    ? Number(process.env.TWO_STAGE_MIN_DELAY_MS)
    : 10000; // 10 seconds

let maxDelayMs = Number.isFinite(Number(process.env.TWO_STAGE_MAX_DELAY_MS))
    ? Number(process.env.TWO_STAGE_MAX_DELAY_MS)
    : 25000; // 25 seconds

if (minDelayMs > maxDelayMs) {
    console.warn(`Swapping min/max delay: ${minDelayMs} > ${maxDelayMs}`);
    const tmp = minDelayMs;
    minDelayMs = maxDelayMs;
    maxDelayMs = tmp;
}

const generationPrompts = (process.env.TWO_STAGE_GEN_PROMPTS || "")
    .split("||")
    .map((s) => s.trim())
    .filter(Boolean);

if (generationPrompts.length === 0) {
    generationPrompts.push(
        "cinematic portrait of a spacefarer gazing at a nebula",
        "lush forest clearing at dawn with crystalline waterfalls and ethereal wildlife",
        "retro-futuristic city skyline at sunset with hovering ships",
        "battle-ready mage summoning luminous glyphs in a ruined cathedral",
        "steampunk explorer overlooking a floating archipelago",
        "mythic beast emerging from misty mountains",
        "mecha pilot preparing for launch on an illuminated runway",
        "ancient library guarded by arcane spirits"
    );
}

const generationNegatives = (process.env.TWO_STAGE_GEN_NEGATIVES || "")
    .split("||")
    .map((s) => s.trim())
    .filter(Boolean);

if (generationNegatives.length === 0) {
    generationNegatives.push(
        "lowres, blurry, bad anatomy, extra limbs, watermark, text, signature",
        "poor lighting, washed out colors, distorted perspective, nsfw",
        "cropped face, missing fingers, artifacts, posterization",
        "muted colors, flat lighting, repetitive patterns"
    );
}

const editPrompts = (process.env.TWO_STAGE_EDIT_PROMPTS || "")
    .split("||")
    .map((s) => s.trim())
    .filter(Boolean);

if (editPrompts.length === 0) {
    editPrompts.push(
        "Shift to a nighttime scene with glowing lanterns and gentle rain, add reflective puddles",
        "Transform into a winter landscape with snowfall and frosted trees, keep main subject",
        "Reimagine as a bustling cyberpunk alley filled with holographic signs and neon rain",
        "Convert the environment to a tranquil seaside at sunrise with warm golden lighting",
        "Reframe as an autumn festival with floating lanterns and soft embers",
        "Turn into a bioluminescent jungle with fog and glowing flora",
        "Adapt into a desert oasis at twilight with swirling dust and warm rim light"
    );
}

const generationLighting = [
    "dramatic rim lighting",
    "soft volumetric sunrise glow",
    "diffuse moonlit ambience",
    "harsh crystalline highlights",
    "warm golden hour light",
    "cool ambient neon glow"
];

let jobCount = 0;
let successCount = 0;
let failCount = 0;
const startTime = Date.now();

/**
 * Helper to wait for SmartPool job completion
 */
function waitForSmartPoolJob(pool: SmartPool, jobId: string): Promise<JobRecord> {
    const job = pool.getJob(jobId);
    if (job) {
        if (job.status === "completed") {
            return Promise.resolve(job);
        }
        if (job.status === "failed" || job.status === "cancelled") {
            return Promise.reject(job);
        }
    }

    return new Promise((resolve, reject) => {
        const completedListener = (e: CustomEvent<{ job: JobRecord }>) => {
            try {
                const job = e.detail.job as any;
                if (job.id === jobId || job.jobId === jobId) {
                    cleanUp();
                    resolve(e.detail.job);
                }
            } catch (error) {
                console.error("Error in job:completed listener:", error);
            }
        };
        const failedListener = (e: CustomEvent<{ job: JobRecord; willRetry?: boolean }>) => {
            try {
                const job = e.detail.job as any;
                if ((job.id === jobId || job.jobId === jobId) && !e.detail.willRetry) {
                    cleanUp();
                    reject(e.detail.job);
                }
            } catch (error) {
                console.error("Error in job:failed listener:", error);
            }
        };
        const cancelledListener = (e: CustomEvent<{ job: JobRecord }>) => {
            try {
                const job = e.detail.job as any;
                if (job.id === jobId || job.jobId === jobId) {
                    cleanUp();
                    reject(e.detail.job);
                }
            } catch (error) {
                console.error("Error in job:cancelled listener:", error);
            }
        };
        const cleanUp = () => {
            pool.off("job:completed", completedListener as any);
            pool.off("job:failed", failedListener as any);
            pool.off("job:cancelled", cancelledListener as any);
        };
        pool.on("job:completed", completedListener as any);
        pool.on("job:failed", failedListener as any);
        pool.on("job:cancelled", cancelledListener as any);
    });
}

/**
 * Main simulation function
 */
async function runSimulation() {
    log("blue", `[SmartPool Two-Stage Simulation] Starting with ${hosts.length} hosts: ${hosts.join(", ")}`);
    log("blue", `Generation host: ${GEN_HOST}, Edit hosts: ${EDIT_HOSTS.join(", ")}`);

    const pool = new SmartPool(hosts);
    await pool.connect();

    // Set affinity: generation jobs go to GEN_HOST, edit jobs go to EDIT_HOSTS
    const genWorkflowHash = hashWorkflow(GenerationGraph);
    const editWorkflowHash = hashWorkflow(EditGraph);

    pool.setAffinity(GenerationGraph, {
        preferredClientIds: [GEN_HOST]
    });

    pool.setAffinity(EditGraph, {
        preferredClientIds: EDIT_HOSTS
    });

    log("green", `[SmartPool Two-Stage Simulation] Affinities configured`);
    log("green", `  Generation (${genWorkflowHash.substring(0, 8)}...): ${GEN_HOST}`);
    log("green", `  Edit (${editWorkflowHash.substring(0, 8)}...): ${EDIT_HOSTS.join(", ")}`);

    // Listen to job events for logging
    pool.on("job:queued", (e: any) => {
        jobCount++;
        log("cyan", `[Job ${jobCount}] Queued: ${e.detail.job.jobId.substring(0, 8)}...`);
    });

    pool.on("job:completed", (e: any) => {
        successCount++;
        log("green", `[✓ Success ${successCount}] Job ${e.detail.job.jobId.substring(0, 8)}... completed`);
    });

    pool.on("job:failed", (e: any) => {
        failCount++;
        log("red", `[✗ Failed ${failCount}] Job ${e.detail.job.jobId.substring(0, 8)}... failed: ${e.detail.job.lastError}`);
    });

    const runtimeEnd = startTime + runtimeMs;
    const generatedImages: Array<{ jobId: string; genClientId: string; imageRecord: any; prompts: string[] }> = [];
    let currentlyQueuedGenJobs = 0; // Track jobs currently queued in SmartPool
    let enqueueGenContinuously = true;
    const maxPrefill = 2; // Max number of generation jobs to keep queued in SmartPool (safety limit for ComfyUI queue)

    // Producer task: continuously enqueue generation jobs
    const producerTask = (async () => {
        try {
            while (enqueueGenContinuously && Date.now() < runtimeEnd) {
                // Only enqueue if we haven't exceeded maxPrefill
                if (currentlyQueuedGenJobs >= maxPrefill) {
                    await new Promise((resolve) => setTimeout(resolve, 100));
                    continue;
                }

                const genPrompt = pickRandom(generationPrompts);
                const genNegative = pickRandom(generationNegatives);
                const genSeed = nextSeed("random");
                const genWorkflow = buildGenerationWorkflow(genPrompt, genNegative, genSeed);

                log("yellow", `[Gen] Enqueuing generation: "${genPrompt.substring(0, 40)}..."`);
                const genJobId = await pool.enqueue(genWorkflow, {
                    preferredClientIds: [GEN_HOST]
                });
                currentlyQueuedGenJobs++;

                // Random user think time between generation requests (simulates real-world usage)
                const userThinkTime = randomInt(minDelayMs, maxDelayMs);
                await new Promise((resolve) => setTimeout(resolve, userThinkTime));

                // Fire-and-forget: wait for generation in background and add to queue
                waitForSmartPoolJob(pool, genJobId)
                    .then((genJob) => {
                        log("green", `[Gen] Generation completed for job ${genJobId.substring(0, 8)}...`);

                        // Extract image from result
                        const basePreview = (genJob.result as any).base_preview ?? (genJob.result as any)["12"];
                        const records = Array.isArray(basePreview?.images)
                            ? basePreview.images
                            : Array.isArray(basePreview)
                                ? basePreview
                                : basePreview
                                    ? [basePreview]
                                    : [];

                        if (records.length > 0) {
                            // Randomize number of edits per generation (1-3)
                            const editsPerGeneration = randomInt(1, 3);
                            // Store generated image with associated edit prompts
                            const editPromptList = Array.from({ length: editsPerGeneration }, () =>
                                pickRandom(editPrompts)
                            );
                            generatedImages.push({
                                jobId: genJobId,
                                genClientId: genJob.clientId || GEN_HOST,
                                imageRecord: records[0],
                                prompts: editPromptList
                            });
                            log("cyan", `[Queue] Image ${genJobId.substring(0, 8)}... queued for ${editsPerGeneration} edits`);
                        }

                        // Decrement queued count now that this job is done
                        currentlyQueuedGenJobs--;
                    })
                    .catch((e) => {
                        log("red", `[Gen] Generation failed: ${e}`);
                        // Decrement queued count on failure too
                        currentlyQueuedGenJobs--;
                    });

                // Small delay between generation enqueues to spread load
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
        } catch (error) {
            log("red", `[Producer] Error: ${error}`);
        }
    })();

    // Consumer task: process edits on available images
    const consumerTask = (async () => {
        try {
            while (Date.now() < runtimeEnd) {
                if (generatedImages.length === 0) {
                    // Wait briefly for first generation to complete
                    await new Promise((resolve) => setTimeout(resolve, 100));
                    continue;
                }

                // Get first image with remaining edits
                const sourceGen = generatedImages[0];
                if (sourceGen.prompts.length === 0) {
                    log("cyan", `[Queue] Image ${sourceGen.jobId.substring(0, 8)}... finished all edits`);
                    generatedImages.shift();
                    continue;
                }

                const editPrompt = sourceGen.prompts.shift()!;
                const targetEditClientId = pickRandom(EDIT_HOSTS);

                log("yellow", `[Edit] Preparing edit from ${sourceGen.jobId.substring(0, 8)}...: "${editPrompt.substring(0, 40)}..."`);

                try {
                    const genClient = pool.clientMap.get(sourceGen.genClientId);
                    if (!genClient) {
                        log("red", `[Edit] ERROR: Generation client ${sourceGen.genClientId} not found`);
                        // Put edit back in queue
                        sourceGen.prompts.unshift(editPrompt);
                        await new Promise((resolve) => setTimeout(resolve, 500));
                        continue;
                    }

                    const targetEditClient = pool.clientMap.get(targetEditClientId);
                    if (!targetEditClient) {
                        log("red", `[Edit] ERROR: Edit client ${targetEditClientId} not found`);
                        // Put edit back in queue
                        sourceGen.prompts.unshift(editPrompt);
                        await new Promise((resolve) => setTimeout(resolve, 500));
                        continue;
                    }

                    // Upload image to edit client
                    try {
                        const imageUrl = genClient.ext.file.getPathImage(sourceGen.imageRecord as any);
                        const uploadName = `two-stage-${Date.now()}-${Math.random().toString(16).slice(2)}.png`;
                        await uploadImage(imageUrl, uploadName, targetEditClient);
                        log("cyan", `[Edit] Uploaded image to ${uploadName} on ${targetEditClientId}`);

                        // Create and enqueue edit workflow
                        const editWorkflow = buildEditWorkflow(uploadName, editPrompt, nextSeed("random"));
                        const editJobId = await pool.enqueue(editWorkflow, {
                            preferredClientIds: [targetEditClientId]
                        });
                        log("cyan", `[Edit] Enqueued edit job ${editJobId.substring(0, 8)}...`);

                        // Random user think time before next edit request (simulates user reviewing results)
                        const userEditThinkTime = randomInt(Math.floor(minDelayMs * 0.5), Math.floor(maxDelayMs * 0.5));
                        await new Promise((resolve) => setTimeout(resolve, userEditThinkTime));

                        // Wait for edit to complete (non-blocking)
                        waitForSmartPoolJob(pool, editJobId)
                            .then(() => {
                                log("green", `[✓ Edit Success] Job ${editJobId.substring(0, 8)}... completed`);
                            })
                            .catch((e) => {
                                log("red", `[Edit] Edit job failed: ${e}`);
                            });
                    } catch (uploadError) {
                        log("red", `[Edit] ERROR uploading image: ${uploadError}`);
                        // Put edit back in queue
                        sourceGen.prompts.unshift(editPrompt);
                    }
                } catch (error) {
                    log("red", `[Edit] ERROR preparing edit: ${error}`);
                    // Put edit back in queue to retry
                    sourceGen.prompts.unshift(editPrompt);
                }

                // Small delay between edit enqueues
                await new Promise((resolve) => setTimeout(resolve, 300));
            }
        } catch (error) {
            log("red", `[Consumer] FATAL ERROR: ${error}`);
        }
    })();

    try {
        // Run both tasks concurrently until timeout
        await Promise.all([
            producerTask,
            consumerTask
        ]).catch((error) => {
            if (error.message !== "Simulation timeout") {
                log("red", `[Task error] ${error}`);
            }
        });
    } catch (error) {
        log("red", `[Simulation] Error during execution: ${error}`);
    } finally {
        enqueueGenContinuously = false;
        pool.shutdown();
        const totalDurationMs = Date.now() - startTime;
        const totalDurationSecs = (totalDurationMs / 1000).toFixed(1);
        const successRate = ((successCount / (successCount + failCount)) * 100).toFixed(1);

        console.log("\n" + "=".repeat(80));
        log("bold", `[SmartPool Two-Stage Simulation] Final Summary`);
        console.log("=".repeat(80));
        log("cyan", `Total Jobs:      ${jobCount}`);
        log("green", `Successful:      ${successCount}`);
        log("red", `Failed:          ${failCount}`);
        log("blue", `Success Rate:    ${successRate}%`);
        log("magenta", `Total Duration:  ${totalDurationSecs}s`);
        log("magenta", `Avg Job Time:    ${(totalDurationMs / Math.max(1, jobCount)).toFixed(0)}ms`);
        console.log("=".repeat(80) + "\n");

        if (failCount > 0) {
            process.exit(1);
        }
    }
}

// Run the simulation
runSimulation().catch((error) => {
    log("red", `[SmartPool Two-Stage Simulation] Fatal error: ${error}`);
    process.exit(1);
});
