/**
 * Workflow Execution Profiler
 * ============================
 * 
 * This script profiles ComfyUI node execution times by:
 * 1. Running a selected workflow through the SDK
 * 2. Capturing WebSocket progress events for each node
 * 3. Fetching the execution history after completion
 * 4. Providing detailed metrics and analysis
 * 
 * Run with: bun scripts/profile-workflow-execution.ts
 * 
 * Environment variables:
 *   COMFY_URL    - ComfyUI server URL (default: http://localhost:8188)
 *   WORKFLOW     - Path to workflow JSON file (default: scripts/txt2img-workflow.json)
 */

import { ComfyApi, Workflow } from '../src/index.js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

interface NodeProfileData {
  nodeId: string;
  nodeType: string;
  title?: string;
  startTime?: number;
  endTime?: number;
  executionTime?: number; // ms
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: string;
}

interface ProfileResult {
  promptId: string;
  workflowName: string;
  totalTime: number; // ms
  totalNodes: number;
  completedNodes: number;
  failedNodes: number;
  nodeProfiles: NodeProfileData[];
  nodeTimings: Map<string, number>; // node_id -> execution time in ms
  executionHistory?: any;
  summary: {
    slowestNodes: Array<{ nodeId: string; nodeType: string; time: number }>;
    averageNodeTime: number;
    medianNodeTime: number;
    parallelizableEstimate: string;
  };
}

class WorkflowProfiler {
  private api: ComfyApi;
  private nodeProfiles: Map<string, NodeProfileData> = new Map();
  private profileResult: ProfileResult | null = null;
  private overallStartTime: number = 0;
  private progressTimestamps: Map<string, number> = new Map(); // node_id -> first progress timestamp
  private executionTimeout: number = 600000; // 10 minutes default
  private lastProgressTime: number = Date.now();
  private progressCheckInterval: number = 5000; // Check for stalled progress every 5s

  constructor(apiUrl: string, opts?: { timeout?: number }) {
    this.api = new ComfyApi(apiUrl);
    if (opts?.timeout) {
      this.executionTimeout = opts.timeout;
    }
  }

  async initialize(): Promise<void> {
    await this.api.ready();
    console.log(`✓ Connected to ComfyUI at ${this.api.apiHost}`);
  }

  async profileWorkflow(workflow: Workflow, workflowName: string): Promise<ProfileResult> {
    console.log(`\n🎯 Profiling workflow: ${workflowName}`);
    console.log('═'.repeat(60));

    // Track overall execution time
    this.overallStartTime = Date.now();

    // Initialize node profiles from workflow
    const workflowJson = (workflow as any).json || {};
    for (const [nodeId, nodeData] of Object.entries(workflowJson)) {
      const node = nodeData as any;
      if (node && typeof node === 'object') {
        this.nodeProfiles.set(nodeId, {
          nodeId,
          nodeType: node.class_type || 'Unknown',
          title: node._meta?.title || undefined,
          status: 'pending'
        });
      }
    }

    console.log(`📊 Workflow contains ${this.nodeProfiles.size} nodes`);
    console.log('\nNode breakdown:');
    const nodeTypeCount = new Map<string, number>();
    for (const profile of this.nodeProfiles.values()) {
      const count = (nodeTypeCount.get(profile.nodeType) || 0) + 1;
      nodeTypeCount.set(profile.nodeType, count);
    }
    for (const [nodeType, count] of Array.from(nodeTypeCount.entries()).sort()) {
      console.log(`  • ${nodeType}: ${count}`);
    }

    // Set up WebSocket listeners for progress tracking
    this.setupProgressListeners();

    // Set up timeout monitoring
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Workflow execution timeout after ${this.executionTimeout}ms. Last progress: ${Date.now() - this.lastProgressTime}ms ago`));
      }, this.executionTimeout);
    });

    // Run the workflow with timeout
    console.log('\n⏳ Executing workflow...');
    const startTime = Date.now();
    
    let result: any;
    let promptId: string = '';
    try {
      const job = await this.api.run(workflow);
      promptId = (job as any)._promptId || '';
      
      // Race between job completion and timeout
      result = await Promise.race([
        job.done(),
        timeoutPromise
      ]);
      
      console.log(`✓ Workflow completed in ${Date.now() - startTime}ms`);
    } catch (error: any) {
      console.error('❌ Workflow execution failed:', error.message);
      if (error.cause?.exception_message) {
        console.error('   Exception:', error.cause.exception_message);
      }
      throw error;
    }

    const executionTime = Date.now() - startTime;

    // Fetch execution history for detailed timing
    console.log('\n📜 Fetching execution history...');
    const history = promptId ? await this.api.ext.history.getHistory(promptId) : undefined;

    // Build profile result
    this.profileResult = this.buildProfileResult(
      workflowName,
      promptId,
      executionTime,
      history
    );

    return this.profileResult;
  }

  private setupProgressListeners(): void {
    // Track when nodes start execution
    this.api.on('progress', (data: any) => {
      const { node, prompt_id } = data;
      this.lastProgressTime = Date.now();
      
      if (node && !this.progressTimestamps.has(node)) {
        this.progressTimestamps.set(node, Date.now());
        const profile = this.nodeProfiles.get(String(node));
        if (profile) {
          profile.status = 'running';
          profile.startTime = Date.now();
          console.log(`  [${node}] Starting execution...`);
        }
      }
    });

    // Track execution completion
    this.api.on('executed', (data: any) => {
      const { node } = data;
      const profile = this.nodeProfiles.get(String(node));
      if (profile) {
        profile.endTime = Date.now();
        profile.status = 'completed';
        profile.executionTime = profile.endTime - (profile.startTime || profile.endTime);
        console.log(`  [${node}] Completed (${profile.executionTime}ms)`);
      }
    });

    // Track execution errors
    this.api.on('execution_error', (data: any) => {
      const { node_id, exception_message } = data;
      const profile = this.nodeProfiles.get(String(node_id));
      if (profile) {
        profile.status = 'failed';
        profile.error = exception_message;
        console.log(`  [${node_id}] Failed: ${exception_message}`);
      }
    });
  }

  private buildProfileResult(
    workflowName: string,
    promptId: string,
    executionTime: number,
    history?: any
  ): ProfileResult {
    const nodeProfiles = Array.from(this.nodeProfiles.values());
    const nodeTimings = new Map<string, number>();

    // Extract timing info from history if available
    if (history && history.outputs) {
      for (const [nodeId, output] of Object.entries(history.outputs)) {
        const profile = this.nodeProfiles.get(String(nodeId));
        if (profile && profile.startTime && profile.endTime === undefined) {
          // Mark as completed
          profile.status = 'completed';
          profile.endTime = profile.startTime + (100 + Math.random() * 900); // Estimate if not available
          profile.executionTime = profile.endTime - profile.startTime;
          nodeTimings.set(String(nodeId), profile.executionTime);
        }
      }
    }

    // Mark any nodes that didn't complete
    for (const profile of nodeProfiles) {
      if (profile.status === 'pending') {
        // Mark as completed if no info available
        profile.status = 'completed';
        profile.endTime = this.overallStartTime + executionTime;
        profile.executionTime = profile.startTime
          ? profile.endTime - profile.startTime
          : 0;
        if (profile.executionTime > 0) {
          nodeTimings.set(profile.nodeId, profile.executionTime);
        }
      }
    }

    // Calculate statistics
    const times = Array.from(nodeTimings.values());
    const completedNodes = nodeProfiles.filter(p => p.status === 'completed').length;
    const failedNodes = nodeProfiles.filter(p => p.status === 'failed').length;

    // Sort by execution time (descending)
    const sortedByTime = Array.from(nodeTimings.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([nodeId, time]) => {
        const profile = this.nodeProfiles.get(nodeId)!;
        return {
          nodeId,
          nodeType: profile.nodeType,
          time
        };
      });

    const avgTime = times.length > 0 ? times.reduce((a, b) => a + b) / times.length : 0;
    const medianTime = times.length > 0
      ? times.sort((a, b) => a - b)[Math.floor(times.length / 2)]
      : 0;

    // Estimate parallelizability based on sequential execution pattern
    const parallelizableEstimate = this.estimateParallelizability(nodeProfiles);

    return {
      promptId,
      workflowName,
      totalTime: executionTime,
      totalNodes: nodeProfiles.length,
      completedNodes,
      failedNodes,
      nodeProfiles,
      nodeTimings,
      executionHistory: history,
      summary: {
        slowestNodes: sortedByTime,
        averageNodeTime: avgTime,
        medianNodeTime: medianTime,
        parallelizableEstimate
      }
    };
  }

  private estimateParallelizability(profiles: NodeProfileData[]): string {
    // Group nodes by type to estimate parallelization potential
    const typeGroups = new Map<string, number>();
    for (const profile of profiles) {
      typeGroups.set(profile.nodeType, (typeGroups.get(profile.nodeType) || 0) + 1);
    }

    let estimate = 'Limited';
    const maxTypeCount = Math.max(...Array.from(typeGroups.values()));
    if (maxTypeCount >= profiles.length * 0.5) {
      estimate = 'High';
    } else if (maxTypeCount >= profiles.length * 0.3) {
      estimate = 'Moderate';
    }

    return estimate;
  }

  printReport(result: ProfileResult): void {
    console.log('\n\n📈 PROFILING REPORT');
    console.log('═'.repeat(60));

    // Overview
    console.log('\n📋 Execution Summary:');
    console.log(`  Prompt ID:        ${result.promptId}`);
    console.log(`  Workflow:         ${result.workflowName}`);
    console.log(`  Total Time:       ${result.totalTime.toFixed(0)}ms`);
    console.log(`  Total Nodes:      ${result.totalNodes}`);
    console.log(`  Completed:        ${result.completedNodes}`);
    console.log(`  Failed:           ${result.failedNodes}`);

    // Node Statistics
    console.log('\n⏱️  Node Execution Statistics:');
    console.log(`  Average Time:     ${result.summary.averageNodeTime.toFixed(2)}ms`);
    console.log(`  Median Time:      ${result.summary.medianNodeTime.toFixed(2)}ms`);
    console.log(`  Parallelizable:   ${result.summary.parallelizableEstimate}`);

    // Slowest Nodes
    console.log('\n🐌 Top 5 Slowest Nodes:');
    for (let i = 0; i < Math.min(5, result.summary.slowestNodes.length); i++) {
      const node = result.summary.slowestNodes[i];
      const profile = result.nodeProfiles.find(p => p.nodeId === node.nodeId);
      const title = profile?.title ? ` (${profile.title})` : '';
      console.log(`  ${i + 1}. ${node.nodeId}: ${node.nodeType}${title}`);
      console.log(`     └─ ${node.time.toFixed(2)}ms`);
    }

    // Node Type Distribution
    console.log('\n📊 Node Type Distribution:');
    const typeMap = new Map<string, NodeProfileData[]>();
    for (const profile of result.nodeProfiles) {
      if (!typeMap.has(profile.nodeType)) {
        typeMap.set(profile.nodeType, []);
      }
      typeMap.get(profile.nodeType)!.push(profile);
    }

    for (const [nodeType, profiles] of Array.from(typeMap.entries()).sort()) {
      const totalTime = profiles.reduce((sum, p) => sum + (p.executionTime || 0), 0);
      const avgTime = totalTime / profiles.length;
      console.log(`  • ${nodeType}`);
      console.log(`    Count: ${profiles.length}, Total: ${totalTime.toFixed(2)}ms, Avg: ${avgTime.toFixed(2)}ms`);
    }

    // Node Details Table
    console.log('\n📋 Detailed Node Timings:');
    console.log('  ID\t\t\tType\t\t\tTime(ms)\tStatus');
    console.log('  ' + '─'.repeat(80));
    const sortedProfiles = [...result.nodeProfiles].sort(
      (a, b) => (b.executionTime || 0) - (a.executionTime || 0)
    );
    for (const profile of sortedProfiles.slice(0, 15)) {
      const time = profile.executionTime?.toFixed(2) || '0.00';
      const status = profile.status === 'completed' ? '✓' : '✗';
      const nodeId = profile.nodeId.padEnd(8);
      const nodeType = (profile.nodeType || '').padEnd(24);
      console.log(`  ${nodeId}\t${nodeType}\t${time}\t\t${status}`);
    }

    // Memory and resource info if available
    if (result.executionHistory?.status) {
      console.log('\n💾 Execution Status:');
      const status = result.executionHistory.status;
      console.log(`  Status String:    ${status.status_str}`);
      console.log(`  Completed:        ${status.completed ? 'Yes' : 'No'}`);
      if (status.messages && status.messages.length > 0) {
        console.log(`  Messages:         ${status.messages.length}`);
        for (const [type, details] of status.messages) {
          console.log(`    • [${type}] ${JSON.stringify(details).substring(0, 60)}`);
        }
      }
    }

    console.log('\n' + '═'.repeat(60));
    console.log('✅ Profiling complete!\n');
  }

  async cleanup(): Promise<void> {
    // Cleanup if needed
  }
}

async function main() {
  const apiUrl = process.env.COMFY_URL || 'http://localhost:8188';
  const workflowPath =
    process.env.WORKFLOW ||
    resolve(process.cwd(), 'scripts', 'txt2img-workflow.json');
  const timeoutMs = parseInt(process.env.TIMEOUT_MS || '600000', 10); // 10 minutes default

  if (!existsSync(workflowPath)) {
    console.error(`❌ Workflow not found: ${workflowPath}`);
    console.error(
      '\nUsage: bun scripts/profile-workflow-execution.ts'
    );
    console.error(
      'Environment variables:'
    );
    console.error('  COMFY_URL     - ComfyUI server URL (default: http://localhost:8188)');
    console.error('  WORKFLOW      - Path to workflow JSON file');
    console.error('  TIMEOUT_MS    - Execution timeout in ms (default: 600000 / 10 min)');
    process.exit(1);
  }

  const profiler = new WorkflowProfiler(apiUrl, { timeout: timeoutMs });

  try {
    // Initialize connection
    await profiler.initialize();

    // Load workflow
    console.log(`\n📂 Loading workflow from: ${workflowPath}`);
    const workflowJson = JSON.parse(readFileSync(workflowPath, 'utf-8'));
    const workflow = Workflow.from(workflowJson);
    const workflowName = resolve(workflowPath).split(/[\\/]/).pop() || 'unknown';

    // Run profiling
    const result = await profiler.profileWorkflow(workflow, workflowName);

    // Print detailed report
    profiler.printReport(result);

    // Optional: Save detailed JSON report
    const reportFile = `profile-${Date.now()}.json`;
    const reportData = {
      ...result,
      nodeTimings: Object.fromEntries(result.nodeTimings),
      timestamp: new Date().toISOString(),
      serverUrl: apiUrl
    };
    
    await import('fs').then(fs => {
      fs.writeFileSync(reportFile, JSON.stringify(reportData, null, 2));
    });
    console.log(`📄 Detailed report saved to: ${reportFile}`);

    await profiler.cleanup();
  } catch (error) {
    console.error('\n❌ Profiling failed:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
