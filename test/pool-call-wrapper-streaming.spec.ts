import { describe, it, expect } from 'bun:test';
import { ComfyPool } from '../src/pool';
import { CallWrapper } from '../src/call-wrapper';
import { PromptBuilder } from '../src/prompt-builder';

// Extend Mock-like API to support appendPrompt / history needed by CallWrapper
class MockComfyApi extends EventTarget {
  id: string;
  osType = 'posix';
  ext: any;
  private ready = false;
  private queueRemaining = 0;
  private history: Record<string, any> = {};

  constructor(id: string) {
    super();
    this.id = id;
    this.ext = {
      monitor: { isSupported: false, on: () => {} },
  queue: { appendPrompt: async (wf: any) => { const pid = `${this.id}-job`; this.queueRemaining = 1; (this as any).activePid = pid; this.emitStatus(1); return { prompt_id: pid }; } },
      history: { getHistory: async (pid: string) => this.history[pid] },
      node: { getNodeDefs: async () => ({}) }
    };
  }
  async init() { this.ready = true; this.emitStatus(0); return this; }
  on(type: string, fn: any) {
    const handler = (ev: any) => fn(ev);
    this.addEventListener(type as any, handler);
    return () => this.removeEventListener(type as any, handler);
  }
  destroy() {}
  emitStatus(q: number) { this.dispatchEvent(new CustomEvent('status', { detail: { status: { exec_info: { queue_remaining: q } } } })); }
  private activePid: string | null = null;
  simulateLifecycle(pid: string, builder: PromptBuilder<any,any,any>) {
    this.activePid = pid;
    // executing + progress frames + previews + executed + success
    setTimeout(() => {
      this.dispatchEvent(new CustomEvent('executing', { detail: { prompt_id: pid, node: 'A' } }));
      for (let v=1; v<=3; v++) {
        setTimeout(()=> this.dispatchEvent(new CustomEvent('progress', { detail: { prompt_id: pid, node: 'A', value: v, max: 3 } })), v*5);
      }
      // previews interleaved
      setTimeout(()=> this.dispatchEvent(new CustomEvent('b_preview', { detail: new Blob([new Uint8Array([1,2,3])], { type: 'image/jpeg' }) })), 8);
      setTimeout(()=> this.dispatchEvent(new CustomEvent('b_preview', { detail: new Blob([new Uint8Array([4,5,6])], { type: 'image/png' }) })), 14);
      // executed mapped node
      setTimeout(()=> {
        this.dispatchEvent(new CustomEvent('executed', { detail: { prompt_id: pid, node: 'B', output: { images: [{ filename: 'x.png', subfolder: '', type: 'output' }] } } }));
        this.dispatchEvent(new CustomEvent('execution_success', { detail: { prompt_id: pid } }));
        this.activePid = null;
        this.emitStatus(0);
      }, 25);
    }, 0);
  }
  async getQueue() {
    if (this.activePid) {
      return { queue_pending: [[0,this.activePid]], queue_running: [] };
    }
    return { queue_pending: [], queue_running: [] };
  }
}

function buildWorkflow() {
  return {
    A: { class_type: 'EmptyLatentImage', inputs: { width: 8, height: 8, batch_size: 1 } },
    B: { class_type: 'SaveImage', inputs: { images: ['A',0], filename_prefix: 'x' } }
  } as any;
}

describe('ComfyPool + CallWrapper streaming', () => {
  it('handles progress & preview events through pool-run job', async () => {
    const clients = [new MockComfyApi('c1'), new MockComfyApi('c2')];
    const pool = new ComfyPool(clients as any);
    // Wait briefly for pool init
    await new Promise(r => setTimeout(r, 10));

    const pb = new PromptBuilder(buildWorkflow(), [], ['out']);
    pb.setOutputNode('out','B');

    let progress = 0; let previews = 0; let finished = false;

    const result = await pool.run(async (api: any) => {
      const wrapper = new CallWrapper(api, pb)
        .onProgress(()=>progress++)
        .onPreview(()=>previews++)
        .onFinished(()=>finished=true)
        .onFailed(e=> { throw e; });

      const runP = wrapper.run();
      // simulate events
      api.simulateLifecycle(`${api.id}-job`, pb);
      return await runP;
    });

    expect(progress).toBeGreaterThanOrEqual(3);
    expect(previews).toBeGreaterThanOrEqual(2);
    expect(finished).toBe(true);
    expect(result && (result as any).out).toBeDefined();
    pool.destroy();
  });
});
