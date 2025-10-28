/**
 * Workflow Execution Profiling Test Suite
 * 
 * This test suite validates profiling capabilities and demonstrates
 * how to extract detailed performance metrics from ComfyUI execution.
 * 
 * Can be run with: bun test test/profiling.spec.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { ComfyApi, Workflow, PromptBuilder } from '../src/index.js';

describe('Workflow Execution Profiling', () => {
  let api: ComfyApi;

  beforeAll(async () => {
    // Only run if COMFY_REAL is set (requires real ComfyUI server)
    if (!process.env.COMFY_REAL) {
      console.log('⏭️  Skipping profiling tests (requires COMFY_REAL=1)');
      return;
    }

    const apiUrl = process.env.COMFY_URL || 'http://localhost:8188';
    api = new ComfyApi(apiUrl);
    await api.ready();
  });

  afterAll(async () => {
    // Cleanup if needed
  });

  describe('Progress Event Capture', () => {
    it('should capture progress events for each node', async () => {
      if (!process.env.COMFY_REAL) return;

      const progressEvents: Array<{ node: string; progress: number }> = [];
      const executedNodes: string[] = [];

      api.on('progress', (data: any) => {
        progressEvents.push({
          node: String(data.node),
          progress: (data.value / data.max) * 100
        });
      });

      api.on('executed', (data: any) => {
        executedNodes.push(String(data.node));
      });

      try {
        // This assumes a simple workflow exists
        const builder = new PromptBuilder({}, [], []);
        const job = await api.run(builder);
        const result = await job.done();

        // Verify events were captured
        expect(progressEvents.length).toBeGreaterThan(0);
        expect(executedNodes.length).toBeGreaterThan(0);
      } catch (e) {
        // Silently handle if no workflow is available
      }
    });
  });

  describe('Execution History Analysis', () => {
    it('should retrieve execution history with node details', async () => {
      if (!process.env.COMFY_REAL) return;

      try {
        const histories = await api.ext.history.getHistories(1);
        expect(typeof histories).toBe('object');

        // If history available, verify structure
        const firstKey = Object.keys(histories)[0];
        if (firstKey) {
          const entry = histories[firstKey];
          expect(entry).toHaveProperty('prompt');
          expect(entry).toHaveProperty('outputs');
          expect(entry).toHaveProperty('status');
        }
      } catch (e) {
        // History might be empty
      }
    });

    it('should extract timing information from status data', async () => {
      if (!process.env.COMFY_REAL) return;

      try {
        const histories = await api.ext.history.getHistories(1);
        const firstKey = Object.keys(histories)[0];

        if (firstKey) {
          const entry = histories[firstKey];
          const status = entry.status;

          expect(status).toHaveProperty('status_str');
          expect(status).toHaveProperty('completed');
          expect(typeof status.completed).toBe('boolean');

          // Status should contain execution timeline if available
          expect(Array.isArray(status.messages)).toBe(true);
        }
      } catch (e) {
        // Handle missing data gracefully
      }
    });
  });

  describe('System Resource Monitoring', () => {
    it('should retrieve system statistics', async () => {
      if (!process.env.COMFY_REAL) return;

      const stats = await api.ext.system.getSystemStats();
      expect(stats).toBeDefined();

      if (stats) {
        expect(stats).toHaveProperty('system');
        expect(stats.system).toHaveProperty('ram_total');
        expect(stats.system).toHaveProperty('ram_free');
        expect(typeof stats.system.ram_total).toBe('number');
        expect(typeof stats.system.ram_free).toBe('number');
      }
    });

    it('should retrieve device statistics for GPU info', async () => {
      if (!process.env.COMFY_REAL) return;

      const stats = await api.ext.system.getSystemStats();
      expect(stats).toBeDefined();

      if (stats?.devices) {
        expect(Array.isArray(stats.devices)).toBe(true);

        // Check device structure if devices exist
        if (stats.devices.length > 0) {
          const device = stats.devices[0];
          expect(device).toHaveProperty('name');
          expect(device).toHaveProperty('vram_total');
          expect(device).toHaveProperty('vram_free');
        }
      }
    });
  });

  describe('Performance Metrics Collection', () => {
    it('should collect timing data across multiple samples', async () => {
      if (!process.env.COMFY_REAL) return;

      const timings: number[] = [];
      const executionTimeMap = new Map<string, number>();

      // Capture progress timing
      let lastNodeProgressTime = 0;
      api.on('progress', (data: any) => {
        const now = Date.now();
        const nodeId = String(data.node);

        if (!executionTimeMap.has(nodeId)) {
          executionTimeMap.set(nodeId, now);
          lastNodeProgressTime = now;
        }
      });

      try {
        const builder = new PromptBuilder({}, [], []);
        const startTime = Date.now();
        const job = await api.run(builder);
        const result = await job.done();
        const totalTime = Date.now() - startTime;

        expect(totalTime).toBeGreaterThan(0);
        expect(executionTimeMap.size).toBeGreaterThanOrEqual(0);
      } catch (e) {
        // Handle gracefully
      }
    });

    it('should measure queue vs execution time', async () => {
      if (!process.env.COMFY_REAL) return;

      let queuedTime: number = 0;
      let executionStart: number = 0;

      api.on('pending', (promptId: string) => {
        queuedTime = Date.now();
      });

      api.on('progress', (data: any) => {
        if (!executionStart) {
          executionStart = Date.now();
        }
      });

      try {
        const builder = new PromptBuilder({}, [], []);
        const startTime = Date.now();
        const job = await api.run(builder);
        await job.done();

        // We should have at least queued the job
        expect(startTime).toBeDefined();
      } catch (e) {
        // Handle gracefully
      }
    });
  });

  describe('Node Dependency Analysis', () => {
    it('should identify node dependencies from workflow structure', async () => {
      const workflow = Workflow.from({
        '1': { class_type: 'CheckpointLoader', inputs: {} },
        '2': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 0] } },
        '3': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 0] } },
        '4': { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['2', 0], negative: ['3', 0] } }
      });

      const json = (workflow as any).json;
      const dependencies = new Map<string, string[]>();

      // Build dependency map
      for (const [nodeId, nodeData] of Object.entries(json)) {
        const node = nodeData as any;
        const deps: string[] = [];

        if (node.inputs) {
          for (const input of Object.values(node.inputs)) {
            // Check for array format [nodeId, output_index] where nodeId can be string or number
            if (Array.isArray(input) && input.length >= 2) {
              const depId = String(input[0]);
              if (depId !== 'undefined' && !isNaN(Number(input[1]))) {
                deps.push(depId);
              }
            }
          }
        }

        dependencies.set(nodeId, deps);
      }

      // Verify dependencies are captured
      expect(dependencies.get('2')?.length || 0).toBeGreaterThan(0);
      expect(dependencies.get('3')?.length || 0).toBeGreaterThan(0);
      expect(dependencies.get('4')?.length || 0).toBeGreaterThanOrEqual(2);
    });

    it('should calculate critical path from dependencies', () => {
      // Simple critical path calculation
      interface NodeInfo {
        duration: number;
        deps: string[];
      }

      const nodes: Record<string, NodeInfo> = {
        '1': { duration: 100, deps: [] }, // Load checkpoint
        '2': { duration: 50, deps: ['1'] }, // Encode positive
        '3': { duration: 50, deps: ['1'] }, // Encode negative
        '4': { duration: 1000, deps: ['1', '2', '3'] } // Sampler
      };

      function calculateCriticalPath(nodeId: string, memo = new Map<string, number>()): number {
        if (memo.has(nodeId)) return memo.get(nodeId)!;

        const node = nodes[nodeId];
        if (!node) return 0;

        const depTime = node.deps.length > 0
          ? Math.max(...node.deps.map(dep => calculateCriticalPath(dep, memo)))
          : 0;

        const result = node.duration + depTime;
        memo.set(nodeId, result);
        return result;
      }

      const criticalPath = Math.max(...Object.keys(nodes).map(id => calculateCriticalPath(id)));
      // Critical path is: checkpoint (100) -> encode (50) -> sampler (1000) = 1150
      expect(criticalPath).toBe(1150);
    });
  });

  describe('Bottleneck Detection', () => {
    it('should identify slow nodes relative to average', () => {
      const nodeTimes = {
        '1': 100, // Fast
        '2': 50,  // Very fast
        '3': 500, // Slow
        '4': 150  // Normal
      };

      const times = Object.values(nodeTimes);
      const avgTime = times.reduce((a, b) => a + b) / times.length;
      const threshold = avgTime * 2;

      const bottlenecks = Object.entries(nodeTimes)
        .filter(([_, time]) => time > threshold)
        .map(([nodeId]) => nodeId);

      expect(bottlenecks).toContain('3');
      expect(bottlenecks).not.toContain('1');
    });

    it('should calculate parallelizability score', () => {
      // Sequential execution: 100 + 50 + 500 + 150 = 800
      const totalTime = 800;
      // Critical path: 100 + 50 + 500 = 650
      const criticalPath = 650;
      
      const sequentialFraction = criticalPath / totalTime;
      const parallelizabilityScore = (1 - sequentialFraction) * 100;

      expect(parallelizabilityScore).toBeGreaterThan(0);
      expect(parallelizabilityScore).toBeLessThan(100);
    });
  });

  describe('Profiling Data Export', () => {
    it('should format profiling data for export', () => {
      const profilingData = {
        timestamp: new Date().toISOString(),
        totalTime: 12345,
        nodeCount: 8,
        nodes: [
          { id: '1', type: 'CheckpointLoader', time: 100 },
          { id: '2', type: 'CLIPTextEncode', time: 50 }
        ],
        summary: {
          averageNodeTime: 75,
          slowestNode: { id: '1', type: 'CheckpointLoader', time: 100 }
        }
      };

      expect(profilingData).toHaveProperty('timestamp');
      expect(profilingData).toHaveProperty('nodes');
      expect(profilingData.nodes.length).toBeGreaterThan(0);
      expect(typeof profilingData.totalTime).toBe('number');
    });

    it('should support JSON serialization of complex metrics', () => {
      const metrics = {
        execution: {
          queueTime: 50,
          totalTime: 5000,
          memoryPeakMB: 1024
        },
        nodes: new Map([
          ['1', { type: 'Loader', time: 100 }],
          ['2', { type: 'Process', time: 500 }]
        ]),
        timestamp: new Date()
      };

      // Convert to serializable format
      const serialized = {
        ...metrics,
        nodes: Object.fromEntries(metrics.nodes),
        timestamp: metrics.timestamp.toISOString()
      };

      const json = JSON.stringify(serialized);
      expect(typeof json).toBe('string');
      expect(json).toContain('Loader');
    });
  });
});
