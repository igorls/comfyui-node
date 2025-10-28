/**
 * Test: Execution Start Timeout
 * ==============================
 * 
 * This test verifies that WorkflowPool properly handles the case where a server
 * gets stuck before emitting the execution_start event.
 * 
 * Scenario:
 * 1. Server accepts the prompt (enqueues successfully)
 * 2. Server gets stuck and never emits execution_start
 * 3. WorkflowPool should timeout after executionStartTimeoutMs
 * 4. Job should be retried on another server
 * 
 * This prevents jobs from being lost when servers hang.
 * 
 * Run with: bun scripts/test-execution-start-timeout.ts
 */

import { ComfyApi, WorkflowPool, Workflow } from '../src/index.js';
import { EventEmitter } from 'events';

class MockComfyApi extends EventEmitter {
  apiHost: string;
  clientId: string;
  private shouldStuck: boolean;

  constructor(host: string, clientId: string, shouldStuck: boolean = false) {
    super();
    this.apiHost = host;
    this.clientId = clientId;
    this.shouldStuck = shouldStuck;
  }

  async ready() {
    return Promise.resolve();
  }

  ext = {
    queue: {
      appendPrompt: async (workflow: any) => {
        const promptId = `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        
        // Simulate server accepting the prompt
        setTimeout(() => {
          this.emit('pending', { prompt_id: promptId });
        }, 50);

        if (!this.shouldStuck) {
          // Normal server - emit execution_start after a short delay
          setTimeout(() => {
            this.emit('execution_start', { prompt_id: promptId });
            
            // Complete execution after another delay
            setTimeout(() => {
              this.emit('executing', { node: null, prompt_id: promptId });
              this.emit('executed', {
                node: '9',
                output: { images: [{ filename: 'test.png', subfolder: '', type: 'output' }] },
                prompt_id: promptId
              });
            }, 100);
          }, 100);
        } else {
          // Stuck server - never emits execution_start
          console.log(`[${this.clientId}] ⚠️  Server stuck! Will not emit execution_start`);
        }

        return { prompt_id: promptId };
      },
      interrupt: async (promptId: string) => {
        console.log(`[${this.clientId}] Interrupted prompt: ${promptId}`);
      }
    },
    file: {
      uploadImage: async () => ({ name: 'test.png', subfolder: '', type: 'output' })
    }
  };
}

async function main() {
  console.log('\n🧪 Test: Execution Start Timeout\n');
  console.log('═'.repeat(70));

  // Create mock clients
  const stuckClient = new MockComfyApi('http://stuck-server:8188', 'stuck-client', true) as any;
  const healthyClient = new MockComfyApi('http://healthy-server:8188', 'healthy-client', false) as any;

  // Create workflow pool with short timeout for testing
  const pool = new WorkflowPool([stuckClient, healthyClient], {
    executionStartTimeoutMs: 2000, // 2 second timeout
    enableProfiling: true
  });

  await pool.ready();

  // Create simple workflow
  const workflow = Workflow.from({
    '9': {
      inputs: { filename_prefix: 'test', images: ['8', 0] },
      class_type: 'SaveImage',
      _meta: { title: 'Save Image' }
    }
  });

  console.log('\n📊 Test Scenario:');
  console.log('  1. First server (stuck) accepts prompt but never starts execution');
  console.log('  2. Pool should timeout after 2 seconds');
  console.log('  3. Job should retry on second server (healthy)');
  console.log('  4. Job should complete successfully\n');

  let jobStartedCount = 0;
  let jobFailedCount = 0;
  let jobRetryingCount = 0;
  let executionStartTime: number | undefined;

  pool.on('job:started', (event) => {
    jobStartedCount++;
    const clientId = event.detail.job.clientId;
    console.log(`[${jobStartedCount}] 🚀 Job started on: ${clientId}`);
  });

  pool.on('job:failed', (event) => {
    jobFailedCount++;
    const { job, willRetry } = event.detail;
    const error = job.lastError as Error;
    console.log(`[${jobFailedCount}] ❌ Job failed on ${job.clientId}: ${error?.message}`);
    console.log(`    Will retry: ${willRetry}`);
  });

  pool.on('job:retrying', (event) => {
    jobRetryingCount++;
    const { job, delayMs } = event.detail;
    console.log(`[${jobRetryingCount}] 🔄 Retrying job after ${delayMs}ms delay`);
  });

  pool.on('job:completed', (event) => {
    const { job } = event.detail;
    const stats = job.profileStats;
    
    console.log(`\n✅ Job completed on: ${job.clientId}`);
    
    if (stats) {
      console.log(`\n📊 Profile Stats:`);
      console.log(`   Total Duration: ${stats.totalDuration}ms`);
      console.log(`   Queue Time: ${stats.queueTime}ms`);
      console.log(`   Execution Time: ${stats.executionTime}ms`);
      console.log(`   Attempts: ${job.attempts}`);
    }
  });

  console.log('Starting test...\n');
  const startTime = Date.now();

  try {
    const jobId = await pool.enqueue(workflow);
    console.log(`Job ${jobId} enqueued\n`);

    // Wait for completion
    await new Promise<void>((resolve, reject) => {
      pool.on('job:completed', () => resolve());
      pool.on('job:failed', (event) => {
        if (!event.detail.willRetry) {
          reject(new Error('Job failed without retry'));
        }
      });
      
      // Overall timeout
      setTimeout(() => reject(new Error('Test timeout')), 15000);
    });

    const totalTime = Date.now() - startTime;

    console.log('\n' + '═'.repeat(70));
    console.log('📈 Test Results:');
    console.log('═'.repeat(70));
    console.log(`Total test time: ${totalTime}ms`);
    console.log(`Job started count: ${jobStartedCount} (expected: 2)`);
    console.log(`Job failed count: ${jobFailedCount} (expected: 1)`);
    console.log(`Job retrying count: ${jobRetryingCount} (expected: 1)`);

    if (jobStartedCount === 2 && jobFailedCount === 1 && jobRetryingCount === 1) {
      console.log('\n✅ TEST PASSED!');
      console.log('   - First server timed out correctly');
      console.log('   - Job was retried on second server');
      console.log('   - Job completed successfully');
    } else {
      console.log('\n❌ TEST FAILED!');
      console.log('   Event counts do not match expected values');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Test error:', error);
    process.exit(1);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
