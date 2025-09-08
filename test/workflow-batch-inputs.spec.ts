import { describe, it, expect } from 'bun:test';
import { Workflow } from '../src/workflow.ts';

const sample = {
  SAMPLER: {
    class_type: 'KSampler',
    inputs: { steps: 20, cfg: 8, seed: -1 }
  },
  CLIP: {
    class_type: 'CLIPTextEncode',
    inputs: { text: 'hello' }
  }
};

describe('Workflow batchInputs()', () => {
  it('updates multiple inputs for one node', () => {
    const wf = Workflow.from(sample);
    wf.batchInputs('SAMPLER', { steps: 30, cfg: 10 });
    // @ts-ignore access internal json
    const json = (wf as any).json;
    expect(json.SAMPLER.inputs.steps).toBe(30);
    expect(json.SAMPLER.inputs.cfg).toBe(10);
  });

  it('updates multiple nodes via object form', () => {
    const wf = Workflow.from(sample);
    wf.batchInputs({ SAMPLER: { steps: 25 }, CLIP: { text: 'world' } });
    // @ts-ignore
    const json = (wf as any).json;
    expect(json.SAMPLER.inputs.steps).toBe(25);
    expect(json.CLIP.inputs.text).toBe('world');
  });

  it('throws in strict mode when node missing', () => {
    const wf = Workflow.from(sample);
    expect(() => wf.batchInputs('NO_NODE' as any, { foo: 1 } as any, { strict: true })).toThrow();
  });

  it('provides type safety (compile-time)', () => {
    const wf = Workflow.from(sample);
    // @ts-expect-error unknown input key
    wf.batchInputs('SAMPLER', { unknownKey: 1 } as any);
    // @ts-expect-error unknown node id
    wf.batchInputs('NOT_A_NODE' as any, { steps: 10 } as any);
  });
});
