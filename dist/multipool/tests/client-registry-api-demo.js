/**
 * Client Registry API Demo for MultiWorkflowPool
 *
 * Demonstrates the public API methods for safely accessing client registry information
 */
import { MultiWorkflowPool } from "../multi-workflow-pool.js";
import { Workflow } from "../workflow.js";
import GenerationGraph from "../../../scripts/workflows/T2I-one-obsession.json" with { type: "json" };
const GEN_HOST = "http://localhost:8188";
// Create pool
const pool = new MultiWorkflowPool({});
const genWorkflow = Workflow.fromAugmented(GenerationGraph);
pool.addClient(GEN_HOST, {
    workflowAffinity: [genWorkflow],
    priority: 10
});
console.log("\n" + "=".repeat(80));
console.log("CLIENT REGISTRY API DEMO - MultiWorkflowPool");
console.log("=".repeat(80));
console.log("Testing: Public API methods for accessing client registry");
console.log("=".repeat(80) + "\n");
// Test getClients() before initialization
console.log("📋 getAllClients() - Before Initialization:");
const clientsBeforeInit = pool.getClients();
console.log(`  Total clients registered: ${clientsBeforeInit.length}`);
clientsBeforeInit.forEach(client => {
    console.log(`  - ${client.nodeName} (${client.url})`);
    console.log(`    State: ${client.state}`);
    console.log(`    Priority: ${client.priority ?? "N/A"}`);
    console.log(`    Workflow Affinities: ${client.workflowAffinityHashes?.length ?? 0}`);
});
// Test getClient() for specific client
console.log("\n🔍 getClient(url) - Specific Client Lookup:");
const specificClient = pool.getClient(GEN_HOST);
if (specificClient) {
    console.log(`  Found: ${specificClient.nodeName}`);
    console.log(`  State: ${specificClient.state}`);
    console.log(`  Priority: ${specificClient.priority}`);
}
else {
    console.log("  Client not found");
}
// Test getClientsForWorkflow()
console.log("\n🎯 getClientsForWorkflow() - Affinity Matching:");
const affinityClients = pool.getClientsForWorkflow(genWorkflow);
console.log(`  Clients with affinity for generation workflow: ${affinityClients.length}`);
affinityClients.forEach(url => {
    console.log(`  - ${url}`);
});
// Test hasClientsForWorkflow()
console.log("\n✅ hasClientsForWorkflow() - Availability Check:");
const hasClients = pool.hasClientsForWorkflow(genWorkflow);
console.log(`  Has clients for workflow: ${hasClients}`);
// Initialize the pool
console.log("\n🚀 Initializing pool...\n");
await pool.init();
// Test getClients() after initialization
console.log("\n📋 getClients() - After Initialization:");
const clientsAfterInit = pool.getClients();
clientsAfterInit.forEach(client => {
    console.log(`  - ${client.nodeName} (${client.url})`);
    console.log(`    State: ${client.state}`);
    console.log(`    Priority: ${client.priority ?? "N/A"}`);
});
// Test getIdleClients()
console.log("\n⏸️  getIdleClients() - Available Workers:");
const idleClients = pool.getIdleClients();
console.log(`  Idle clients: ${idleClients.length}`);
idleClients.forEach(client => {
    console.log(`  - ${client.nodeName} (priority: ${client.priority ?? "N/A"})`);
});
// Test getPoolStats() before submitting jobs
console.log("\n📊 getPoolStats() - Before Job Submission:");
const statsBeforeJob = pool.getPoolStats();
console.log(`  Total Clients: ${statsBeforeJob.totalClients}`);
console.log(`  Idle: ${statsBeforeJob.idleClients}`);
console.log(`  Busy: ${statsBeforeJob.busyClients}`);
console.log(`  Offline: ${statsBeforeJob.offlineClients}`);
console.log(`  Total Queues: ${statsBeforeJob.totalQueues}`);
statsBeforeJob.queues.forEach(q => {
    const hashDisplay = q.workflowHash === "general"
        ? "general"
        : q.workflowHash.substring(0, 12) + "...";
    console.log(`  Queue [${hashDisplay}] (${q.type}): ${q.pendingJobs} pending jobs`);
});
// Submit a job to see state changes
console.log("\n📤 Submitting job to observe state changes...\n");
const workflow = Workflow.fromAugmented(GenerationGraph)
    .input("1", "value", "test image")
    .input("10", "steps", 5)
    .input("10", "seed", 42);
const jobId = await pool.submitJob(workflow);
// Check stats during job execution
console.log("📊 getPoolStats() - During Job Execution:");
const statsDuringJob = pool.getPoolStats();
console.log(`  Total Clients: ${statsDuringJob.totalClients}`);
console.log(`  Idle: ${statsDuringJob.idleClients}`);
console.log(`  Busy: ${statsDuringJob.busyClients}`);
console.log(`  Offline: ${statsDuringJob.offlineClients}`);
statsDuringJob.queues.forEach(q => {
    const hashDisplay = q.workflowHash === "general"
        ? "general"
        : q.workflowHash.substring(0, 12) + "...";
    console.log(`  Queue [${hashDisplay}] (${q.type}): ${q.pendingJobs} pending jobs`);
});
// Wait for completion
await pool.waitForJobCompletion(jobId);
// Check stats after job completion
console.log("\n📊 getPoolStats() - After Job Completion:");
const statsAfterJob = pool.getPoolStats();
console.log(`  Total Clients: ${statsAfterJob.totalClients}`);
console.log(`  Idle: ${statsAfterJob.idleClients}`);
console.log(`  Busy: ${statsAfterJob.busyClients}`);
console.log(`  Offline: ${statsAfterJob.offlineClients}`);
statsAfterJob.queues.forEach(q => {
    const hashDisplay = q.workflowHash === "general"
        ? "general"
        : q.workflowHash.substring(0, 12) + "...";
    console.log(`  Queue [${hashDisplay}] (${q.type}): ${q.pendingJobs} pending jobs`);
});
console.log("\n" + "=".repeat(80));
console.log("API METHODS SUMMARY");
console.log("=".repeat(80));
console.log("✅ getClients() - Get all registered clients with their state");
console.log("✅ getClient(url) - Get specific client information");
console.log("✅ getClientsForWorkflow(workflow) - Get clients with workflow affinity");
console.log("✅ getIdleClients() - Get all currently idle clients");
console.log("✅ hasClientsForWorkflow(workflow) - Check workflow availability");
console.log("✅ getPoolStats() - Get comprehensive pool statistics");
console.log("=".repeat(80));
await pool.shutdown();
console.log("\n✅ Client registry API demo completed, exiting...");
process.exit(0);
//# sourceMappingURL=client-registry-api-demo.js.map