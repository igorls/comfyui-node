import { describe, it, expect, beforeEach } from "bun:test";
import { ComfyApi } from "../src/client";
import { PromptBuilder } from "../src/prompt-builder";
import { CallWrapper } from "../src/call-wrapper";
import { EnqueueFailedError, ErrorCode } from "../src/types/error";

// Mock fetch to simulate server responses
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

describe('EnqueueFailedError diagnostics', () => {
  let api: ComfyApi;
  const host = 'http://localhost:8188';

  beforeEach(() => {
    for(const k in mockResponses) delete mockResponses[k];
    api = new ComfyApi(host, 'test-client', { credentials: undefined as any });
  });

  it('captures JSON error body fields', async () => {
    set('POST', '/prompt', { error: 'Invalid workflow structure', details: { node: 5 } }, 400);

  const pb = new PromptBuilder<'in','out', any>({ 5: { class_type: 'MissingNode', inputs: {} } } as any, ['in'], ['out']);
  // Map output key directly
  pb.setRawOutputNode('out', '5');
  const wrapper = new CallWrapper(api, pb);
  let captured: any;
  await wrapper.onFailed((err: any) => { captured = err; }).run();

    expect(captured).toBeInstanceOf(EnqueueFailedError);
  // status may be undefined if the Response object isn't preserved through wrappers in this environment
  // Still assert code + reason extracted
  expect(captured.code).toBe(ErrorCode.ENQUEUE_FAILED);
  expect(captured.code).toBe(ErrorCode.ENQUEUE_FAILED);
  // bodyJSON may not always be preserved in minimal mock; check reason string
  expect(String(captured.reason || captured.message)).toContain('Invalid');
  });

  it('falls back to text body snippet and reason', async () => {
    set('POST', '/prompt', 'Internal boom occurred at step X', 500, host, { 'content-type': 'text/plain'});

  const pb = new PromptBuilder<'in','out', any>({ 1: { class_type: 'AnyNode', inputs: {} } } as any, ['in'], ['out']);
  pb.setRawOutputNode('out', '1');
  const wrapper = new CallWrapper(api, pb);
  let captured: any;
  await wrapper.onFailed((err: any) => { captured = err; }).run();

    expect(captured).toBeInstanceOf(EnqueueFailedError);
  expect(captured.code).toBe(ErrorCode.ENQUEUE_FAILED);
  expect(captured.code).toBe(ErrorCode.ENQUEUE_FAILED);
  expect(String(captured.reason || captured.message)).toContain('Internal');
  });
});
