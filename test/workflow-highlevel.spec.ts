import { describe, it, expect } from 'bun:test';
import { Workflow } from '../src/workflow';
import { PromptBuilder } from '../src/prompt-builder';

// Minimal FakeApi replicating only necessary surface for CallWrapper
class FakeApi extends EventTarget {
  id = 'api';
  ext: any;
  private queue: any = { queue_pending: [], queue_running: [] };
  constructor() {
    super();
    this.ext = {
      queue: { appendPrompt: async () => { const pid='pid-wf'; this.queue.queue_pending.push([0,pid]); return { prompt_id: pid }; } },
      history: { getHistory: async () => ({ status: { completed: false } }) },
      node: { getNodeDefs: async () => ({}) }
    };
  }
  async getQueue() { return this.queue; }
  on(name: string, fn: any) { this.addEventListener(name, fn as any); return () => this.removeEventListener(name, fn as any); }
  emit(name: string, detail: any) { this.dispatchEvent(new CustomEvent(name, { detail })); }
}

function buildSimple() {
  return {
    A: { class_type: 'EmptyLatentImage', inputs: { width: 8, height: 8, batch_size: 1 } },
    B: { class_type: 'SaveImage', inputs: { images: ['A',0], filename_prefix: 'x' } }
  } as any;
}

describe.skip('Workflow high-level API', () => {
  it('runs workflow, emits progress & resolves outputs', async () => {
    const api = new FakeApi();
    const wf = Workflow.from(buildSimple());
    wf.output('B'); // explicit mapping
  const job = await wf.run(api as any);
  let prog = 0; let finished: any = null; let previewCount=0;
  job.on('progress', () => { prog++; console.log('[wf-test] progress'); })
    .on('preview', () => { previewCount++; console.log('[wf-test] preview'); })
    .on('finished', (data) => { finished = data; console.log('[wf-test] finished'); });

    // simulate lifecycle
    setTimeout(() => {
      // status with job present
      api.emit('status', { status: { exec_info: { queue_pending: 0, queue_remaining: 1 } } });
      api.emit('executing', { prompt_id: 'pid-wf' });
      api.emit('progress', { prompt_id: 'pid-wf', node: 'A', value: 1, max: 1 });
      api.dispatchEvent(new CustomEvent('b_preview', { detail: new Blob([new Uint8Array([1,2,3])], { type: 'image/jpeg' }) }));
      api.emit('executed', { prompt_id: 'pid-wf', node: 'B', output: { images: [{ filename: 'out.png', type: 'output', subfolder: '' }] } });
      api.emit('execution_success', { prompt_id: 'pid-wf' });
      // queue now empty + status event
      api.emit('status', { status: { exec_info: { queue_pending: 0, queue_remaining: 0 } } });
    }, 0);

    const result = await job.done();
    expect(prog).toBeGreaterThan(0);
    expect(previewCount).toBeGreaterThan(0);
    expect(result.B).toBeDefined();
    expect(result._promptId).toBeDefined();
    expect(finished).not.toBeNull();
  });
});
