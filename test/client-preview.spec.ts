import { describe, it, expect } from 'bun:test';
import { ComfyApi } from '../src/client';

// Minimal mock server interaction not needed; we simulate websocket directly by patching internal socket after init() bypass.
// We'll construct a fake client and directly invoke its internal onmessage handler via a fabricated WebSocket-like object.

describe('ComfyApi preview binary frames', () => {
  function buildBinaryFrame(eventType: number, imageType: number, payload: Uint8Array) {
    const header = new ArrayBuffer(8 + payload.length);
    const view = new DataView(header);
    view.setUint32(0, eventType); // event type
    view.setUint32(4, imageType); // image type
    const u8 = new Uint8Array(header);
    u8.set(payload, 8);
    return Buffer.from(u8.buffer);
  }

  async function withClient(fn: (api: ComfyApi, inject: (data: any) => void, events: any[]) => Promise<void>) {
    const api = new ComfyApi('http://localhost:0');
    const events: any[] = [];
    (api as any).dispatchEvent = (ev: any) => { events.push(ev); };
    // Force internal socket creation (will fail to connect; that's fine) then replace with mock
    try { (api as any).createSocket(); } catch { /* ignore */ }
    // Replace real (failed) socket with mock object we control
    const mockSocket: any = { onmessage: null };
    (api as any).socket = mockSocket;
    // Reassign handler by manually invoking the code path that sets onmessage (simplest: re-run createSocket logic guard removed)
    // Easiest is to copy the onmessage block: but instead we simulate by calling the private method again after clearing guard
    (api as any).socket = null; // remove guard
    (api as any).createSocket(); // now sets a fresh real socket; capture handler then transplant
    const realSocket = (api as any).socket;
    mockSocket.onmessage = realSocket.onmessage;
    // ensure client thinks it has a socket
    (api as any).socket = mockSocket;
    await fn(api, (data: any) => mockSocket.onmessage && mockSocket.onmessage({ data }), events);
  }

  it('dispatches b_preview for Buffer binary frame', async () => {
    await withClient(async (api, inject, events) => {
      // simulate creation of message handler logic in init; call private method _createWs like code path
      (api as any).socket = { onmessage: null };
      // call private createWs to set handlers (bypass actual network) - reuse method via bracket
      (api as any)._createWs?.();
      const frame = buildBinaryFrame(1, 2, new Uint8Array([1,2,3,4]));
      inject(frame);
      const previewEv = events.find(e => e.type === 'b_preview');
      expect(previewEv).toBeTruthy();
      expect(previewEv.detail instanceof Blob).toBe(true);
    });
  });

  it('dispatches b_preview for ArrayBuffer binary frame', async () => {
    await withClient(async (api, inject, events) => {
      (api as any).socket = { onmessage: null };
      (api as any)._createWs?.();
      const frame = buildBinaryFrame(1, 1, new Uint8Array([9,9,9]));
      // Provide as ArrayBuffer to simulate alternate delivery
      inject(frame.buffer);
      const previewEv = events.find(e => e.type === 'b_preview');
      expect(previewEv).toBeTruthy();
      expect(previewEv.detail.type).toMatch(/image\/(png|jpeg)/);
    });
  });
});
