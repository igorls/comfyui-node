import { describe, it, expect } from 'bun:test';
console.log('[call-wrapper-streaming] file loaded');
import { CallWrapper } from '../src/call-wrapper';
import { PromptBuilder } from '../src/prompt-builder';

// Lightweight FakeApi replicating subset of ComfyApi event surface needed for CallWrapper
class FakeApi extends EventTarget {
  id = 'fake';
  ext: any;
  private queue: any = { queue_pending: [], queue_running: [] };
  constructor() {
    super();
    this.ext = {
      queue: {
        appendPrompt: async () => {
          const id = 'pid-stream';
          this.queue.queue_pending.push([0,id]);
          return { prompt_id: id };
        }
      },
      history: { getHistory: async () => ({ status: { completed: false } }) },
      node: { getNodeDefs: async () => ({}) }
    };
  }
  async getQueue() { return this.queue; }
  on(name: string, fn: any) { this.addEventListener(name, fn as any); return () => this.removeEventListener(name, fn as any); }
  emit(name: string, detail: any) { this.dispatchEvent(new CustomEvent(name, { detail })); }
}

function buildWorkflow() {
  return {
    A: { class_type: 'EmptyLatentImage', inputs: { width: 8, height: 8, batch_size: 1 } },
    B: { class_type: 'SaveImage', inputs: { images: ['A',0], filename_prefix: 'x' } }
  } as any;
}

describe.skip('CallWrapper streaming (progress + preview)', () => {
  it('delivers progress & preview frames then finishes', async () => {
    console.log('[call-wrapper-streaming] test started');
    const api = new FakeApi();
    const pb = new PromptBuilder(buildWorkflow(), [], ['out']);
    pb.setOutputNode('out','B');

    const wrapper = new CallWrapper(api as any, pb);

    let progressEvents = 0;
    let previews = 0;
    let finished = false;
    wrapper.onProgress(() => progressEvents++);
    wrapper.onPreview(blob => { previews++; expect(blob).toBeInstanceOf(Blob); });
    wrapper.onFinished(() => finished = true);
    wrapper.onFailed(err => { throw err; });

  const runPromise = wrapper.run();
  console.log('[call-wrapper-streaming] run invoked');

    // Simulate execution lifecycle
    setTimeout(() => {
      // Job transitions to executing
      console.log('[call-wrapper-streaming] emitting executing');
      api.emit('executing', { prompt_id: 'pid-stream' });
      // First progress
      console.log('[call-wrapper-streaming] emitting progress 1');
      api.emit('progress', { prompt_id: 'pid-stream', node: 'A', value: 1, max: 2 });
      // Emit preview frame (jpeg)
      console.log('[call-wrapper-streaming] emitting preview jpeg');
      api.dispatchEvent(new CustomEvent('b_preview', { detail: new Blob([new Uint8Array([1,2,3])], { type: 'image/jpeg' }) }));
      // Second progress
      console.log('[call-wrapper-streaming] emitting progress 2');
      api.emit('progress', { prompt_id: 'pid-stream', node: 'A', value: 2, max: 2 });
      // Emit preview frame (png)
      console.log('[call-wrapper-streaming] emitting preview png');
      api.dispatchEvent(new CustomEvent('b_preview', { detail: new Blob([new Uint8Array([4,5,6])], { type: 'image/png' }) }));
      // Executed output node
      console.log('[call-wrapper-streaming] emitting executed');
      api.emit('executed', { prompt_id: 'pid-stream', node: 'B', output: { images: [{ filename: 'x.png', subfolder: '', type: 'output' }] } });
      // Success end
      console.log('[call-wrapper-streaming] emitting execution_success');
      api.emit('execution_success', { prompt_id: 'pid-stream' });
    }, 0);

  const result = await runPromise;
  console.log('[call-wrapper-streaming] run resolved');

    expect(progressEvents).toBeGreaterThanOrEqual(2);
    expect(previews).toBeGreaterThanOrEqual(2);
    expect(finished).toBe(true);
    expect(result && (result as any).out).toBeDefined();
  });
});
