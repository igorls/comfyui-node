import { MultiWorkflowPool } from "../multi-workflow-pool.js";
import { Workflow } from "../workflow.js";
import GenerationGraph from "../../../scripts/workflows/T2I-anime-nova-xl.json" with { type: "json" };
import EditGraph from "../../../scripts/workflows/quick-edit-test.json" with { type: "json" };
import { randomUUID } from "node:crypto";
import { animeXLPromptGenerator, NEGATIVE_PROMPT } from "src/multipool/tests/prompt-generator.js";
import { pickRandom, randomInt, randomSeed } from "./test-helpers.js";
/**
 * Two-Stage Edit Simulation for MultiWorkflowPool
 *
 * This test simulates real-world usage where users:
 * 1. Generate images using text-to-image workflows on a dedicated generation server
 * 2. Edit those generated images using image editing workflows on dedicated edit servers
 *
 * The simulation demonstrates:
 * - Proper workflow affinity routing (generation → GEN_HOST, edits → EDIT_HOSTS)
 * - Concurrent multi-user workflows
 * - Image blob handling through the pool's public API (no direct host access)
 * - Event-driven queue processing and client state management
 *
 * Each TwoStageUser class instance simulates an independent user generating and editing images.
 */ // ============================================================================
// CONFIGURATION
// ============================================================================
const GEN_HOST = "http://localhost:8188";
const EDIT_HOSTS = ["http://localhost:8188", "http://localhost:8188"];
// ============================================================================
// PROMPT GENERATORS
// ============================================================================
const editPrompts = [
    "Shift to a nighttime scene with glowing lanterns and gentle rain, add reflective puddles",
    "Transform into a winter landscape with snowfall and frosted trees, keep main subject",
    "Reimagine as a bustling cyberpunk alley filled with holographic signs and neon rain",
    "Convert the environment to a tranquil seaside at sunrise with warm golden lighting",
    "Reframe as an autumn festival with floating lanterns and soft embers",
    "Turn into a bioluminescent jungle with fog and glowing flora",
    "Adapt into a desert oasis at twilight with swirling dust and warm rim light"
];
// ============================================================================
// POOL SETUP
// ============================================================================
const pool = new MultiWorkflowPool({
    enableMonitoring: true
});
const genWorkflow = Workflow.fromAugmented(GenerationGraph);
const editWorkflow = Workflow.fromAugmented(EditGraph);
console.log(`Generation Workflow Hash: ${genWorkflow.structureHash}`);
console.log(`Edit Workflow Hash: ${editWorkflow.structureHash}`);
// Set affinity mapping: generation on GEN_HOST, editing on EDIT_HOSTS
pool.addClient(GEN_HOST, {
    workflowAffinity: [genWorkflow],
    priority: 1
});
for (const editHost of EDIT_HOSTS) {
    pool.addClient(editHost, {
        workflowAffinity: [editWorkflow],
        priority: 1
    });
}
await pool.init();
export class TwoStageUser {
    userId;
    shouldRun = true;
    totalGenerations = 0;
    generatedImages = [];
    editsPerImage;
    minDelayMs;
    maxDelayMs;
    // Statistics
    stats = {
        generationsStarted: 0,
        generationsCompleted: 0,
        generationsFailed: 0,
        editsStarted: 0,
        editsCompleted: 0,
        editsFailed: 0
    };
    constructor(userId, options = {}) {
        this.userId = userId;
        this.totalGenerations = options.totalGenerations ?? 3;
        this.editsPerImage = options.editsPerImage ?? 2;
        this.minDelayMs = options.minDelayMs ?? 1000;
        this.maxDelayMs = options.maxDelayMs ?? 5000;
    }
    stop() {
        this.shouldRun = false;
    }
    async start() {
        console.log(`\n[${this.userId}] Starting two-stage workflow simulation`);
        console.log(`[${this.userId}] Will generate ${this.totalGenerations} images, each with ${this.editsPerImage} edits`);
        // Start generation and edit loops concurrently
        await Promise.all([
            this.generationLoop(),
            this.editLoop()
        ]);
        console.log(`\n[${this.userId}] Completed workflow simulation`);
        this.printStats();
    }
    async generationLoop() {
        for (let i = 0; i < this.totalGenerations && this.shouldRun; i++) {
            try {
                await this.generateImage();
                await this.delay(randomInt(this.minDelayMs, this.maxDelayMs));
            }
            catch (error) {
                console.error(`[${this.userId}] Error in generation loop:`, error);
            }
        }
    }
    async editLoop() {
        while (this.shouldRun) {
            // Wait if no images are available
            if (this.generatedImages.length === 0) {
                await this.delay(500);
                continue;
            }
            try {
                await this.editImage();
                await this.delay(randomInt(this.minDelayMs, this.maxDelayMs));
            }
            catch (error) {
                console.error(`[${this.userId}] Error in edit loop:`, error);
            }
        }
    }
    async generateImage() {
        const prompt = animeXLPromptGenerator();
        const seed = randomSeed();
        const workflow = Workflow.fromAugmented(GenerationGraph)
            .input("1", "value", prompt)
            .input("2", "value", NEGATIVE_PROMPT)
            .input("10", "steps", 30)
            .input("10", "seed", seed);
        this.stats.generationsStarted++;
        const jobId = await pool.submitJob(workflow);
        console.log(`[${this.userId}] 🎨 Generation started: "${prompt.substring(0, 40)}..." (job: ${jobId.substring(0, 8)})`);
        try {
            const result = await pool.waitForJobCompletion(jobId);
            if (result.status === "completed") {
                this.stats.generationsCompleted++;
                if (result.images.length === 0) {
                    throw new Error("No images returned from generation");
                }
                const imageUrl = result.images[0];
                // Download image from URL as blob
                const response = await fetch(imageUrl);
                if (!response.ok) {
                    throw new Error(`Failed to fetch generated image from ${imageUrl}: ${response.statusText}`);
                }
                const blob = await response.blob();
                // Queue this image for editing
                this.generatedImages.push({
                    jobId,
                    imageRecord: { url: imageUrl, blob },
                    prompt
                });
                console.log(`[${this.userId}] ✅ Generation completed: ${jobId.substring(0, 8)} (${result.images.length} images, queued for ${this.editsPerImage} edits)`);
            }
            else if (result.status === "failed") {
                this.stats.generationsFailed++;
                console.error(`[${this.userId}] ❌ Generation failed: ${jobId.substring(0, 8)}`, result.error);
            }
        }
        catch (error) {
            this.stats.generationsFailed++;
            console.error(`[${this.userId}] ❌ Generation error: ${jobId.substring(0, 8)}`, error);
        }
    }
    async editImage() {
        const genImage = this.generatedImages.shift();
        if (!genImage)
            return;
        for (let i = 0; i < this.editsPerImage && this.shouldRun; i++) {
            const editPrompt = pickRandom(editPrompts);
            try {
                // Create edit workflow with the generated image attached as a blob
                // The pool will handle uploading the image to the assigned edit server
                const editWorkflowInstance = Workflow.fromAugmented(EditGraph)
                    .attachImage("97", "image", genImage.imageRecord.blob, `${randomUUID()}.png`)
                    .input("91", "prompt", editPrompt)
                    .input("51", "seed", -1); // Auto-generate seed        this.stats.editsStarted++;
                const editJobId = await pool.submitJob(editWorkflowInstance);
                console.log(`[${this.userId}] ✏️  Edit ${i + 1}/${this.editsPerImage} started: "${editPrompt.substring(0, 40)}..." (job: ${editJobId.substring(0, 8)})`);
                try {
                    const editResult = await pool.waitForJobCompletion(editJobId);
                    if (editResult.status === "completed") {
                        this.stats.editsCompleted++;
                        console.log(`[${this.userId}] ✅ Edit completed: ${editJobId.substring(0, 8)} (${editResult.images.length} images)`);
                    }
                    else if (editResult.status === "failed") {
                        this.stats.editsFailed++;
                        console.error(`[${this.userId}] ❌ Edit failed: ${editJobId.substring(0, 8)}`, editResult.error);
                    }
                }
                catch (error) {
                    this.stats.editsFailed++;
                    console.error(`[${this.userId}] ❌ Edit error: ${editJobId.substring(0, 8)}`, error);
                }
                // Small delay between edits of the same image
                if (i < this.editsPerImage - 1) {
                    await this.delay(randomInt(500, 1500));
                }
            }
            catch (error) {
                console.error(`[${this.userId}] ❌ Error during edit process:`, error);
            }
        }
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    printStats() {
        console.log(`\n[${this.userId}] === Final Statistics ===`);
        console.log(`  Generations: ${this.stats.generationsCompleted}/${this.stats.generationsStarted} (${this.stats.generationsFailed} failed)`);
        console.log(`  Edits:       ${this.stats.editsCompleted}/${this.stats.editsStarted} (${this.stats.editsFailed} failed)`);
        const totalSuccess = this.stats.generationsCompleted + this.stats.editsCompleted;
        const totalStarted = this.stats.generationsStarted + this.stats.editsStarted;
        const successRate = totalStarted > 0 ? ((totalSuccess / totalStarted) * 100).toFixed(1) : "0.0";
        console.log(`  Success Rate: ${successRate}%`);
    }
}
// ============================================================================
// RUN SIMULATION
// ============================================================================
async function runSimulation() {
    console.log("\n" + "=".repeat(80));
    console.log("TWO-STAGE EDIT SIMULATION - MultiWorkflowPool");
    console.log("=".repeat(80));
    console.log(`Generation Host: ${GEN_HOST}`);
    console.log(`Edit Hosts: ${EDIT_HOSTS.join(", ")}`);
    console.log("=".repeat(80) + "\n");
    // Create multiple simulated users
    const user1 = new TwoStageUser("User-1", {
        totalGenerations: 2,
        editsPerImage: 2,
        minDelayMs: 1000,
        maxDelayMs: 3000
    });
    const user2 = new TwoStageUser("User-2", {
        totalGenerations: 2,
        editsPerImage: 1,
        minDelayMs: 1500,
        maxDelayMs: 4000
    });
    const user3 = new TwoStageUser("User-3", {
        totalGenerations: 1,
        editsPerImage: 3,
        minDelayMs: 2000,
        maxDelayMs: 5000
    });
    // Run all users concurrently
    try {
        await Promise.all([
            user1.start(),
            user2.start(),
            user3.start()
        ]);
        console.log("\n" + "=".repeat(80));
        console.log("SIMULATION COMPLETED SUCCESSFULLY");
        console.log("=".repeat(80));
        // Print combined statistics
        const totalStats = {
            generationsCompleted: user1.stats.generationsCompleted + user2.stats.generationsCompleted + user3.stats.generationsCompleted,
            generationsStarted: user1.stats.generationsStarted + user2.stats.generationsStarted + user3.stats.generationsStarted,
            generationsFailed: user1.stats.generationsFailed + user2.stats.generationsFailed + user3.stats.generationsFailed,
            editsCompleted: user1.stats.editsCompleted + user2.stats.editsCompleted + user3.stats.editsCompleted,
            editsStarted: user1.stats.editsStarted + user2.stats.editsStarted + user3.stats.editsStarted,
            editsFailed: user1.stats.editsFailed + user2.stats.editsFailed + user3.stats.editsFailed
        };
        console.log("\n=== Combined Statistics ===");
        console.log(`  Generations: ${totalStats.generationsCompleted}/${totalStats.generationsStarted} (${totalStats.generationsFailed} failed)`);
        console.log(`  Edits:       ${totalStats.editsCompleted}/${totalStats.editsStarted} (${totalStats.editsFailed} failed)`);
        const totalSuccess = totalStats.generationsCompleted + totalStats.editsCompleted;
        const totalAttempted = totalStats.generationsStarted + totalStats.editsStarted;
        const successRate = totalAttempted > 0 ? ((totalSuccess / totalAttempted) * 100).toFixed(1) : "0.0";
        console.log(`  Overall Success Rate: ${successRate}%\n`);
        const hasFailures = totalStats.generationsFailed > 0 || totalStats.editsFailed > 0;
        if (hasFailures) {
            console.log("⚠️  Some operations failed during the simulation");
            process.exitCode = 1;
        }
    }
    catch (error) {
        console.error("\n❌ SIMULATION FAILED:", error);
        process.exitCode = 1;
    }
    finally {
        await pool.shutdown();
    }
}
runSimulation().then(() => {
    console.log("\n✅ Test script completed, exiting...");
    process.exit(0);
}).catch(error => {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
});
//# sourceMappingURL=two-stage-edit-simulation.js.map