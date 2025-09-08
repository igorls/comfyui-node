import { describe, it, expect } from 'bun:test';
import { ComfyApi } from '../src/client';
import { ComfyPool } from '../src/pool';
import { PromptBuilder } from '../src/prompt-builder';
import { CallWrapper } from '../src/call-wrapper';

// This test simulates end-to-end preview streaming through CallWrapper when executed via ComfyPool.
// We stub network-dependent pieces: queue append, history lookup, and websocket events.

describe.skip('ComfyPool + CallWrapper preview integration (deprecated)', () => {
  function buildMinimalWorkflow() {
    return {
      '1': { class_type: 'EmptyLatentImage', inputs: { width: 8, height: 8, batch_size: 1 } },
      '2': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'x' } }
    } as any;
  }

  async function makeFakeClient(): Promise<ComfyApi> {
    const api = new ComfyApi('http://localhost:0');

    // Patch dispatchEvent to allow our own triggering while recording
    (api as any)._events = [] as any[];
    (api as any).dispatchEvent = function(ev: any) { (api as any)._events.push(ev); return EventTarget.prototype.dispatchEvent.call(api, ev); };

    // Force init() success quickly by patching network calls
    (api as any).ping = async () => ({ status: true });
    (api as any).testFeatures = async () => {};
    // Stub system stats for OS type
    api.ext.system.getSystemStats = async () => ({ system: { os: 'Linux' } } as any);

    // Fake feature probing dependencies
    // Provide queue.appendPrompt to return a stable prompt id
    api.ext.queue.appendPrompt = async () => ({ prompt_id: 'p1' }) as any;
    // History lookup will first return incomplete, then completed with outputs
    let historyCalls = 0;
    api.ext.history.getHistory = async (pid: string) => {
      historyCalls++;
      if (historyCalls < 3) return { status: { completed: false } } as any;
      return { status: { completed: true }, outputs: { '2': { images: [{ filename: 'img.png', subfolder: '', type: 'output' }] } } } as any;
    };
    // File feature to build image path
    api.ext.file.getPathImage = (img: any) => `/view?filename=${img.filename}&type=output`;

    await api.init();
    await api.waitForReady();
    return api;
  }

  it('streams preview blobs while running via pool', async () => {
    const client = await makeFakeClient();
    const pool = new ComfyPool([client]);
    await new Promise(r => setTimeout(r, 10)); // allow pool to finish initialization

    const workflow = buildMinimalWorkflow();
    const inputNames: string[] = []; // no inputs for minimal
  const outputNames: string[] = ['output_2'];
  const prompt = new PromptBuilder(workflow, inputNames, outputNames);
  // Map output_2 -> node id '2'
  prompt.setOutputNode('output_2', '2');

    const wrapper = new CallWrapper(client, prompt);

    let previews = 0;
    let finished = false;

    wrapper.onPreview((blob) => {
      previews++;
      expect(blob instanceof Blob).toBe(true);
    });
    wrapper.onFinished(() => { finished = true; });
    wrapper.onFailed((err) => { throw err; });

    // Simulate preview frames: when run() sets up listeners, we manually dispatch binary preview events.
  const runPromise = wrapper.run();

  // Wait a tick so event listeners are attached internally
  await new Promise(r => setTimeout(r, 5));

  // Simulate job entering queue/executing state to avoid missing logic paths.
  client.dispatchEvent(new CustomEvent('executing', { detail: { prompt_id: 'p1', node: '1' } } as any));
  client.dispatchEvent(new CustomEvent('progress', { detail: { prompt_id: 'p1', value: 1, max: 10 } } as any));

    // Manually push two preview frames (jpeg then png header types) through socket handler.
    const pushPreview = (imageType: number) => {
      const bytes = new Uint8Array(12);
      const view = new DataView(bytes.buffer);
      view.setUint32(0, 1); // event type 1 = preview
      view.setUint32(4, imageType); // image type
      // Fill payload
      bytes.set([1,2,3,4], 8);
      // Directly invoke client's onmessage chain if available
      const socket: any = (client as any).socket;
      if (socket && socket.onmessage) {
        socket.onmessage({ data: bytes });
      } else {
        // Fallback: dispatch b_preview event directly
        client.dispatchEvent(new CustomEvent('b_preview', { detail: new Blob([bytes.slice(8)], { type: imageType === 2 ? 'image/png' : 'image/jpeg' }) }));
      }
    };

    pushPreview(1);
    pushPreview(2);

  // Simulate executed output node event and success end (remainingOutput should hit zero)
  client.dispatchEvent(new CustomEvent('executed', { detail: { prompt_id: 'p1', node: '2', output: { images: [{ filename: 'img.png', subfolder: '', type: 'output' }] } } } as any));
  client.dispatchEvent(new CustomEvent('execution_success', { detail: { prompt_id: 'p1' } } as any));

  const output = await runPromise;

    expect(previews).toBeGreaterThanOrEqual(2);
    expect(finished).toBe(true);
    expect(output).not.toBe(false);
    expect(output && output._raw).toBeDefined();

    pool.destroy();
  });
});
