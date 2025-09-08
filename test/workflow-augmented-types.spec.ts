import { describe, it, expect } from 'bun:test';
import { Workflow } from '../src/workflow.ts';

const wfJson = {
  SAMPLER: { class_type: 'KSampler', inputs: { sampler_name: 'euler', scheduler: 'karras', steps: 20 } }
};

describe('Workflow.fromAugmented', () => {
  it('allows known sampler values and arbitrary strings', () => {
    const wf = Workflow.fromAugmented(wfJson);
    // known literal
    wf.input('SAMPLER','sampler_name','euler');
    // arbitrary new value should still type (string widening)
    const custom = 'my_future_sampler_variant';
    wf.input('SAMPLER','sampler_name', custom);
    wf.batchInputs('SAMPLER',{ scheduler: 'polyexponential' });
    // runtime shape remains intact
    // @ts-ignore internal access
    const json = (wf as any).json;
    expect(json.SAMPLER.inputs.sampler_name).toBe(custom);
  });

  it('still rejects unknown input key at compile-time', () => {
    const wf = Workflow.fromAugmented(wfJson);
    // @ts-expect-error no such input
    wf.input('SAMPLER','not_real_input',123 as any);
  });
});
