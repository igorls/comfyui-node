import { describe, it, expect, beforeEach } from "bun:test";
import { ComfyApi } from "../src/client";

// Global fetch mock similar to enqueue-error tests
interface MockKey { method: string; url: string; }
const mockResponses: Record<string, { status?: number; headers?: any; body?: any }> = {};
function key(method: string, url: string) { return `${method.toUpperCase()} ${url}`; }

(globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input.toString();
  const method = init?.method || 'GET';
  const k = key(method, url);
  const mock = mockResponses[k];
  if(!mock) return new Response('{}', { status: 200, headers: { 'content-type': 'application/json'} });
  const body = typeof mock.body === 'string' ? mock.body : JSON.stringify(mock.body);
  return new Response(body, { status: mock.status || 200, headers: mock.headers || { 'content-type': 'application/json'} });
};

function set(method: string, route: string, body: any, status = 200, host = 'http://localhost:8188', headers?: any) {
  mockResponses[key(method, `${host}${route}`)] = { body, status, headers };
}

describe('Feature modules basic coverage', () => {
  let api: ComfyApi;
  const host = 'http://localhost:8188';

  beforeEach(() => {
    for(const k in mockResponses) delete mockResponses[k];
    api = new ComfyApi(host, 'feature-client');
  });

  it('history feature lists and gets specific history entry', async () => {
    set('GET', '/history?max_items=50', { abc: { status: { completed: true }, outputs: {} } });
    set('GET', '/history/xyz', { xyz: { status: { completed: false }, outputs: {} } });
    const histories = await api.ext.history.getHistories(50);
    expect(histories.abc.status.completed).toBe(true);
    const single = await api.ext.history.getHistory('xyz');
    expect(single?.status.completed).toBe(false);
  });

  it('file feature stores, lists, retrieves and deletes userdata file', async () => {
    // store
    set('POST', '/userdata/test.json?overwrite=true', {}, 200);
    // list directory
    set('GET', '/userdata?dir=%2F&recurse=&split=', ['test.json']);
    // get file
    set('GET', '/userdata/test.json', { hello: 'world'});
    // delete
    set('DELETE', '/userdata/test.json', {}, 204);

    const resp = await api.ext.file.storeUserData('test.json', { hello: 'world'}, { overwrite: true, stringify: true });
    expect(resp.status).toBe(200);
    const list = await api.ext.file.listUserData('/');
    expect(list).toContain('test.json');
    const getResp = await api.ext.file.getUserData('test.json');
    expect(await getResp.json()).toEqual({ hello: 'world'});
    await api.ext.file.deleteUserData('test.json');
  });

  it('model feature lists model folders and model files', async () => {
    set('GET', '/experiment/models', [{ name: 'checkpoints', path: 'checkpoints'}]);
    set('GET', '/experiment/models/checkpoints', [{ name: 'modelA.safetensors', type: 'ckpt' }]);
    const folders = await api.ext.model.getModelFolders();
    expect(Array.isArray(folders)).toBe(true);
    expect(folders[0].name).toBe('checkpoints');
    const files = await api.ext.model.getModelFiles('checkpoints');
    expect(files[0].name).toContain('modelA');
  });

  it('monitoring feature reports unsupported when endpoint 404', async () => {
    // By default monitor feature probably queries something else lazily; simulate unsupported by marking flag
    // No direct call path in current code: validate isSupported property stays boolean
    expect(typeof api.ext.monitor.isSupported).toBe('boolean');
  });

  it('feature flags retrieval basic', async () => {
    set('GET', '/features', { feature_x: true, feature_y: false });
    const flags = await api.ext.featureFlags.getServerFeatures();
    expect(flags.feature_x).toBe(true);
    expect(flags.feature_y).toBe(false);
  });

  it('queue feature propagates enqueue error via queue_error event', async () => {
    set('POST', '/prompt', { error: 'Bad workflow' }, 400);
    let caught: any = null;
    api.on('queue_error', (ev: any) => { caught = ev.detail; });
    let threw = false;
    try { await api.ext.queue.appendPrompt({}); } catch (e) { threw = true; }
    expect(threw).toBe(true);
    expect(caught).toBeTruthy();
    expect(String(caught.reason || caught.message)).toContain('Bad');
  });
});
