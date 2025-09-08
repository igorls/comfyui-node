import { describe, it, expect } from 'bun:test';
import { Workflow } from '../src/workflow.ts';
import Example from './example-txt2img-workflow.json';

describe('Workflow input() sugar', () => {
  it('sets value equivalent to set()', () => {
    const wfA = Workflow.from(Example);
    const wfB = Workflow.from(Example);

    wfA.set('SAMPLER.inputs.steps', 42);
    wfB.input('SAMPLER','steps',42);

    // @ts-ignore internal access for test
    const jsonA = (wfA as any).json;
    // @ts-ignore
    const jsonB = (wfB as any).json;
    expect(jsonB.SAMPLER.inputs.steps).toEqual(42);
    expect(jsonA.SAMPLER.inputs.steps).toEqual(jsonB.SAMPLER.inputs.steps);
  });

  it('creates node shell when non-strict and node missing', () => {
    const wf = Workflow.from({});
    wf.input('FAKE','foo',123); // should not throw
    // @ts-ignore
    expect((wf as any).json.FAKE.inputs.foo).toEqual(123);
  });

  it('throws when strict and node missing', () => {
    const wf = Workflow.from({});
    expect(() => wf.input('NOPE','bar',1,{strict:true})).toThrow();
  });
});
