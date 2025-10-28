/**
 * Advanced Workflow Profiler - Per-Node Timing Analysis
 * ======================================================
 * 
 * This profiler captures:
 * - Per-node execution timing from WebSocket events
 * - Execution order and dependencies
 * - Cached vs executed nodes
 * - Queue timing (pending vs running)
 * - Failure detection and error tracking
 * 
 * Run with: bun scripts/profile-workflow-advanced.ts
 * 
 * Environment variables:
 *   COMFY_URL      - ComfyUI server URL (default: http://localhost:8188)
 *   WORKFLOW       - Path to workflow JSON file (default: scripts/txt2img-workflow.json)
 *   VERBOSE        - Enable verbose event logging (default: false)
 *   TIMEOUT_MS     - Execution timeout in milliseconds (default: 600000)
 */

import { ComfyApi, Workflow, WorkflowPool } from '../src/index.js';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';

interface NodeExecutionEvent {
    nodeId: string;
    eventType: 'queued' | 'progress' | 'started' | 'completed' | 'failed' | 'cached';
    timestamp: number;
    progressValue?: number;
    progressMax?: number;
    error?: string;
}

interface MemorySnapshot {
    timestamp: number;
    ramFree?: number;
    ramTotal?: number;
    devices?: Array<{
        name: string;
        vramFree: number;
        vramTotal: number;
    }>;
}

interface AdvancedProfileResult {
    metadata: {
        promptId: string;
        workflowName: string;
        serverUrl: string;
        startTime: string;
        endTime: string;
        totalDurationMs: number;
    };
    execution: {
        queuedTime: number;
        executionTime: number;
        totalTime: number;
        nodeCount: number;
        parallelExecutionEstimate: {
            criticalPath: number;
            estimatedSpeedup: number;
            parallelizabilityScore: number; // 0-100
        };
    };
    nodes: Array<{
        id: string;
        type: string;
        title?: string;
        queuedAt?: number;
        startedAt?: number;
        completedAt?: number;
        totalTime?: number;
        executionTime?: number;
        status: 'success' | 'failed' | 'cached' | 'unknown';
        errorMessage?: string;
    }>;
    analysis: {
        slowestNodes: Array<{ id: string; type: string; time: number }>;
    };
}

class AdvancedWorkflowProfiler {
  private api: ComfyApi;
  private pool: WorkflowPool;
  private events: NodeExecutionEvent[] = [];
  private memorySnapshots: MemorySnapshot[] = [];
  private nodeProfiles: Map<string, any> = new Map();
  private workflowJson: any;
  private startTimestamp: number = 0;
  private queuedTimestamp: number = 0;
  private verbose: boolean = false;
  private profileMemory: boolean = true;
  private executionTimeout: number = 600000; // 10 minutes default
  private lastProgressTime: number = Date.now();
  private lastExecutingNode: string | null = null;
  private currentPromptId: string | null = null;
  private executionCompletedResolve: (() => void) | null = null;

  constructor(apiUrl: string, opts?: { verbose?: boolean; profileMemory?: boolean; timeout?: number }) {
    this.api = new ComfyApi(apiUrl);
    this.pool = new WorkflowPool([this.api]);
    this.verbose = opts?.verbose || false;
    this.profileMemory = opts?.profileMemory !== false;
    if (opts?.timeout) {
      this.executionTimeout = opts.timeout;
    }
  }  async initialize(): Promise<void> {
    await this.api.ready();
    await this.pool.ready();
    this.log(`✓ Connected to ComfyUI at ${this.api.apiHost}`);
    this.log(`✓ WorkflowPool initialized with 1 client`);
  }    async profileWorkflow(workflow: Workflow, workflowName: string): Promise<AdvancedProfileResult> {
        console.log(`\n🎯 Advanced Profiling: ${workflowName}`);
        console.log('═'.repeat(70));

        this.startTimestamp = Date.now();
        this.workflowJson = (workflow as any).json || {};

        // Initialize node profiles
        this.initializeNodeProfiles();

        // Setup comprehensive event listeners
        this.setupEventListeners();

        console.log(`\n📊 Starting execution...`);
        this.queuedTimestamp = Date.now();

    let promptId: string = '';
    let executionFailed: boolean = false;
    let failureError: Error | null = null;

    // Set up timeout monitoring
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Workflow execution timeout after ${this.executionTimeout}ms. Last progress: ${Date.now() - this.lastProgressTime}ms ago`));
      }, this.executionTimeout);
    });

    try {
      // Enqueue workflow through pool
      const jobId = await this.pool.enqueue(workflow, {
        metadata: { source: 'profiler' }
      });
      
      this.log(`  Job queued: ${jobId}`);

      // Create promise for true execution completion (executing: null event)
      const executionCompletedPromise = new Promise<void>((resolve) => {
        this.executionCompletedResolve = resolve;
      });

      // Wait for job to be accepted by pool and get promptId
      const jobResult = await Promise.race([
        new Promise<any>((resolve, reject) => {
          const offCompleted = this.pool.on('job:completed', (event: any) => {
            if (event.detail.job.jobId !== jobId) return;
            offCompleted();
            offFailed();
            promptId = event.detail.job.promptId || '';
            this.currentPromptId = promptId;
            resolve(event.detail.job.result);
          });
          const offFailed = this.pool.on('job:failed', (event: any) => {
            if (event.detail.job.jobId !== jobId) return;
            offCompleted();
            offFailed();
            promptId = event.detail.job.promptId || '';
            reject(event.detail.job.lastError ?? new Error('workflow failed'));
          });
        }),
        timeoutPromise
      ]);

      // Now wait for TRUE execution completion (executing: null event)
      await Promise.race([executionCompletedPromise, timeoutPromise]);

      this.log('  ✓ Workflow completed successfully');
    } catch (error: any) {
      executionFailed = true;
      failureError = error;
      this.log(`  ✗ Workflow failed: ${error.message}`);
    }

        const endTimestamp = Date.now();

        // Fetch and process history
        const history = promptId && !executionFailed
            ? await this.api.ext.history.getHistory(promptId)
            : undefined;

        // Build comprehensive result
        const result = this.buildAdvancedResult(
            workflowName,
            promptId,
            this.startTimestamp,
            endTimestamp,
            this.queuedTimestamp,
            history,
            failureError
        );

        return result;
    }

    private initializeNodeProfiles(): void {
        for (const [nodeId, nodeData] of Object.entries(this.workflowJson)) {
            const node = nodeData as any;
            if (node && typeof node === 'object') {
                this.nodeProfiles.set(nodeId, {
                    id: nodeId,
                    type: node.class_type || 'Unknown',
                    title: node._meta?.title,
                    status: 'unknown',
                    events: []
                });
            }
        }
        this.log(`  Tracking ${this.nodeProfiles.size} nodes`);
    }

  private setupEventListeners(): void {
    // Use WorkflowPool events which properly capture node execution
    this.pool.on('job:progress', (event: any) => {
      const { progress } = event.detail;
      if (!progress) return;
      
      // Progress object has fields: node, value, max, prompt_id
      const nodeId = progress.node ? String(progress.node) : null;
      const value = progress.value ?? 0;
      const max = progress.max ?? 0;
      const promptId = progress.prompt_id || this.currentPromptId;
      
      this.lastProgressTime = Date.now();

      if (this.verbose) {
        console.log(`  🔄 [POOL:progress] Node: ${nodeId || 'null'}, Progress: ${value}/${max}`);
      }

      if (nodeId) {
        this.events.push({
          nodeId,
          eventType: 'progress',
          timestamp: Date.now(),
          progressValue: value,
          progressMax: max
        });

        const profile = this.nodeProfiles.get(nodeId);
        if (profile) {
          if (!profile.startedAt) {
            profile.startedAt = Date.now();
            this.events.push({
              nodeId,
              eventType: 'started',
              timestamp: Date.now()
            });
            console.log(`  ▶️  [${nodeId}] ${profile.type} - Started execution`);
          }
          profile.lastProgressAt = Date.now();
        }
      }
    });

    // Also listen to API events for detailed node data
    this.api.on('progress', (event: any) => {
      // event is a CustomEvent, data is in event.detail
      const data = event?.detail;
      if (!data) {
        console.log(`  🔄 [API:progress] RAW EVENT:`, JSON.stringify(event).substring(0, 200));
        return;
      }
      const nodeId = data.node ? String(data.node) : null;
      const value = data.value ?? '?';
      const max = data.max ?? '?';
      const promptId = data.prompt_id || this.currentPromptId;
      if (this.verbose) {
        console.log(`  🔄 [API:progress] Node: ${nodeId || 'null'}, Progress: ${value}/${max}`);
      }
    });

    this.api.on('executed', (event: any) => {
      // event is a CustomEvent, data is in event.detail
      const data = event?.detail;
      if (!data) {
        console.log(`  ✅ [API:executed] RAW EVENT:`, JSON.stringify(event).substring(0, 200));
        return;
      }
      const nodeId = data.node ? String(data.node) : null;
      const promptId = data.prompt_id || this.currentPromptId;
      
      if (this.verbose) {
        const outputKeys = data.output ? Object.keys(data.output).join(', ') : 'none';
        console.log(`  ✅ [API:executed] Node: ${nodeId || 'null'}, Outputs: ${outputKeys}`);
      }

      if (nodeId) {
        const profile = this.nodeProfiles.get(nodeId);
        if (profile && !profile.completedAt) {
          profile.completedAt = Date.now();
          profile.status = 'success';
          const duration = profile.completedAt - (profile.startedAt || profile.completedAt);
          console.log(`  ✔️  [${nodeId}] ${profile.type} - Completed (${duration}ms)`);
        }
      }
    });

    this.api.on('execution_error', (event: any) => {
      const data = event?.detail;
      if (!data) return;
      const nodeId = data.node_id ? String(data.node_id) : null;
      console.log(`  ❌ [API:error] Node: ${nodeId || 'null'}, Type: ${data.exception_type}, Message: ${data.exception_message}`);

      if (nodeId) {
        const profile = this.nodeProfiles.get(nodeId);
        if (profile) {
          profile.status = 'failed';
          profile.errorMessage = data.exception_message;
        }
      }
    });

    this.api.on('executing', (event: any) => {
      const data = event?.detail;
      if (!data) return;
      
      const nodeId = data.node ? String(data.node) : null;
      const promptId = data.prompt_id || this.currentPromptId;
      
      if (nodeId) {
        if (this.verbose) {
          console.log(`  🔵 [API:executing] Node: ${nodeId}`);
        }
        
        // If there was a previous executing node, mark it as completed
        if (this.lastExecutingNode && this.lastExecutingNode !== nodeId) {
          const prevProfile = this.nodeProfiles.get(this.lastExecutingNode);
          if (prevProfile && !prevProfile.completedAt) {
            prevProfile.completedAt = Date.now();
            prevProfile.status = 'success';
            const duration = prevProfile.completedAt - (prevProfile.startedAt || prevProfile.completedAt);
            console.log(`  ✔️  [${this.lastExecutingNode}] ${prevProfile.type} - Completed (${duration}ms)`);
          }
        }
        
        // Track execution start
        const profile = this.nodeProfiles.get(nodeId);
        if (profile && !profile.startedAt) {
          profile.startedAt = Date.now();
          this.events.push({
            nodeId,
            eventType: 'started',
            timestamp: Date.now()
          });
        }
        
        this.lastExecutingNode = nodeId;
      } else {
        // node: null means execution ended - complete the last node
        if (this.lastExecutingNode) {
          const prevProfile = this.nodeProfiles.get(this.lastExecutingNode);
          if (prevProfile && !prevProfile.completedAt) {
            prevProfile.completedAt = Date.now();
            prevProfile.status = 'success';
            const duration = prevProfile.completedAt - (prevProfile.startedAt || prevProfile.completedAt);
            console.log(`  ✔️  [${this.lastExecutingNode}] ${prevProfile.type} - Completed (${duration}ms)`);
          }
          this.lastExecutingNode = null;
        }
        console.log(`  🏁 [API:executing] Execution completed, Prompt: ${promptId}`);
        
        // Signal that execution is truly complete
        if (this.executionCompletedResolve) {
          this.executionCompletedResolve();
          this.executionCompletedResolve = null;
        }
      }
    });

    this.api.on('execution_start', (event: any) => {
      const data = event?.detail;
      const promptId = data?.prompt_id || 'unknown';
      this.currentPromptId = promptId;
      console.log(`  🚀 [API:execution_start] Prompt: ${promptId}`);
    });

    this.api.on('execution_cached', (event: any) => {
      const data = event?.detail;
      const nodes = data?.nodes || [];
      const promptId = data?.prompt_id || this.currentPromptId;
      
      if (this.verbose) {
        console.log(`  💾 [API:execution_cached] ${nodes.length} nodes cached`);
      }
      
      // Mark cached nodes as completed instantly
      for (const nodeId of nodes) {
        const id = String(nodeId);
        const profile = this.nodeProfiles.get(id);
        if (profile) {
          const now = Date.now();
          profile.startedAt = now;
          profile.completedAt = now;
          profile.status = 'cached';
          this.events.push({
            nodeId: id,
            eventType: 'cached',
            timestamp: now
          });
        }
      }
    });
  }

    private buildAdvancedResult(
        workflowName: string,
        promptId: string,
        startTime: number,
        endTime: number,
        queuedTime: number,
        history: any,
        failureError: Error | null
    ): AdvancedProfileResult {
        const totalDurationMs = endTime - startTime;
        const executionStartMs = queuedTime - startTime;
        const executionDurationMs = endTime - queuedTime;

        // Process node profiles with timing data
        const nodes = Array.from(this.nodeProfiles.values()).map((profile: any) => ({
            id: profile.id,
            type: profile.type,
            title: profile.title,
            queuedAt: startTime,
            startedAt: profile.startedAt,
            completedAt: profile.completedAt,
            totalTime: profile.completedAt && profile.startedAt
                ? profile.completedAt - profile.startedAt
                : undefined,
            executionTime: profile.completedAt && profile.startedAt
                ? profile.completedAt - profile.startedAt
                : undefined,
            status: profile.status,
            errorMessage: profile.errorMessage
        }));

        // Calculate execution analysis
        const executionTimes = nodes
            .filter(n => n.executionTime)
            .map(n => n.executionTime!)
            .sort((a, b) => b - a);

        const criticalPath = executionTimes[0] || 0;
        const totalExecutionTime = executionTimes.reduce((a, b) => a + b, 0);
        const estimatedSpeedup = totalExecutionTime > 0 ? totalExecutionTime / criticalPath : 1;

        // Parallelizability score (0-100)
        const parallelNodes = nodes.length;
        const sequentialFraction = criticalPath / executionDurationMs;
        const parallelizabilityScore = Math.max(0, Math.min(100, (1 - sequentialFraction) * 100));

        // Get slowest nodes for analysis
        const slowestNodes = nodes
            .filter(n => n.executionTime)
            .sort((a, b) => (b.executionTime || 0) - (a.executionTime || 0))
            .slice(0, 5)
            .map(n => ({ id: n.id, type: n.type, time: n.executionTime || 0 }));

        return {
            metadata: {
                promptId,
                workflowName,
                serverUrl: this.api.apiHost,
                startTime: new Date(startTime).toISOString(),
                endTime: new Date(endTime).toISOString(),
                totalDurationMs
            },
            execution: {
                queuedTime: executionStartMs,
                executionTime: executionDurationMs,
                totalTime: totalDurationMs,
                nodeCount: nodes.length,
                parallelExecutionEstimate: {
                    criticalPath,
                    estimatedSpeedup,
                    parallelizabilityScore
                }
            },
            nodes,
            analysis: {
                slowestNodes
            }
        };
    }

  printReport(result: AdvancedProfileResult): void {
    console.log('\n\n� WORKFLOW EXECUTION PROFILING REPORT');
    console.log('═'.repeat(70));

    // Metadata
    console.log('\n📋 Execution Metadata:');
    console.log(`  Prompt ID:           ${result.metadata.promptId || 'N/A'}`);
    console.log(`  Workflow:            ${result.metadata.workflowName}`);
    console.log(`  Server:              ${result.metadata.serverUrl}`);
    console.log(`  Start:               ${result.metadata.startTime}`);
    console.log(`  Duration:            ${result.metadata.totalDurationMs}ms`);

    // Execution timeline
    console.log('\n⏱️  Execution Timeline:');
    console.log(`  Queue Wait:          ${result.execution.queuedTime}ms`);
    console.log(`  Execution:           ${result.execution.executionTime}ms`);
    console.log(`  Total:               ${result.execution.totalTime}ms`);

    // Node execution summary
    console.log('\n📊 Node Execution Summary:');
    console.log(`  Total Nodes:         ${result.execution.nodeCount}`);
    
    const completedNodes = result.nodes.filter(n => n.status === 'success').length;
    const cachedNodes = result.nodes.filter(n => n.status === 'cached').length;
    const failedNodes = result.nodes.filter(n => n.status === 'failed').length;
    console.log(`  Executed:            ${completedNodes}`);
    console.log(`  Cached:              ${cachedNodes}`);
    console.log(`  Failed:              ${failedNodes}`);

    // Detailed node timing table
    console.log('\n📈 Per-Node Execution Timing:');
    console.log('  ┌────────────┬──────────────────────┬──────────────────┬────────────────┬─────────┐');
    console.log('  │ Node ID    │ Type                 │ Title            │ Duration (ms)  │ Status  │');
    console.log('  ├────────────┼──────────────────────┼──────────────────┼────────────────┼─────────┤');
    
    const sortedNodes = [...result.nodes].sort((a, b) => (b.executionTime || 0) - (a.executionTime || 0));
    
    for (const node of sortedNodes) {
      const nodeId = (node.id || '').substring(0, 10).padEnd(10);
      const nodeType = (node.type || '').substring(0, 20).padEnd(20);
      const title = (node.title || '').substring(0, 16).padEnd(16);
      const duration = ((node.executionTime || 0).toFixed(2) + 'ms').padStart(14);
      const status = node.status === 'success' ? '   ✓   ' : 
                     node.status === 'cached' ? '   💾   ' : 
                     node.status === 'failed' ? '   ✗   ' : '   ?   ';
      
      console.log(`  │ ${nodeId} │ ${nodeType} │ ${title} │ ${duration} │ ${status}│`);
    }
    console.log('  └────────────┴──────────────────────┴──────────────────┴────────────────┴─────────┘');

    // Statistics
    const times = result.nodes
      .filter(n => n.executionTime)
      .map(n => n.executionTime!);
    
    if (times.length > 0) {
      console.log('\n� Node Timing Statistics:');
      const avgTime = times.reduce((a, b) => a + b) / times.length;
      const maxTime = Math.max(...times);
      const minTime = Math.min(...times);
      const totalNodeTime = times.reduce((a, b) => a + b, 0);
      
      console.log(`  Average:             ${avgTime.toFixed(2)}ms`);
      console.log(`  Min:                 ${minTime.toFixed(2)}ms`);
      console.log(`  Max:                 ${maxTime.toFixed(2)}ms`);
      console.log(`  Total (sum):         ${totalNodeTime.toFixed(2)}ms`);
    }

    // Top slowest nodes
    console.log('\n🐌 Top Slowest Nodes:');
    for (let i = 0; i < Math.min(5, result.analysis.slowestNodes.length); i++) {
      const node = result.analysis.slowestNodes[i];
      const profile = result.nodes.find(p => p.id === node.id);
      const title = profile?.title ? ` (${profile.title})` : '';
      console.log(`  ${i + 1}. [${node.id}] ${node.type}${title}: ${node.time.toFixed(2)}ms`);
    }

    console.log('\n' + '═'.repeat(70));
  }

    private log(message: string): void {
        if (this.verbose || message.includes('Started') || message.includes('Completed')) {
            console.log(message);
        }
    }

    async cleanup(): Promise<void> {
        await this.pool.shutdown();
    }
}

async function main() {
    const apiUrl = process.env.COMFY_URL || 'http://localhost:8188';
    const workflowPath =
        process.env.WORKFLOW ||
        resolve(process.cwd(), 'scripts', 'txt2img-workflow.json');
    const verbose = process.env.VERBOSE === 'true';
    const timeoutMs = parseInt(process.env.TIMEOUT_MS || '600000', 10); // 10 minutes default

    if (!existsSync(workflowPath)) {
        console.error(`❌ Workflow not found: ${workflowPath}`);
        process.exit(1);
    }

    const profiler = new AdvancedWorkflowProfiler(apiUrl, {
        verbose,
        timeout: timeoutMs
    });

    try {
        await profiler.initialize();

        console.log(`\n📂 Loading workflow from: ${workflowPath}`);
        const workflowJson = JSON.parse(readFileSync(workflowPath, 'utf-8'));
        const workflow = Workflow.from(workflowJson);
        const workflowName = resolve(workflowPath).split(/[\\/]/).pop() || 'unknown';

        const result = await profiler.profileWorkflow(workflow, workflowName);
        profiler.printReport(result);

        // Save JSON report
        const reportFile = `profile-advanced-${Date.now()}.json`;
        writeFileSync(reportFile, JSON.stringify(result, null, 2));
        console.log(`\n📄 Full report saved to: ${reportFile}\n`);

        await profiler.cleanup();

        console.log('\n✅ Profiling completed successfully.');
        process.exit(0);

    } catch (error) {
        console.error('\n❌ Profiling failed:', error);
        process.exit(1);
    }
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
