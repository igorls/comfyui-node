import { describe, it, expect } from 'bun:test';
import { PromptBuilder } from '../src/prompt-builder';
import { NodeData } from '../src/types/api';

// Minimal workflow conforming to NodeData (each node needs _meta.title)
const baseWorkflow: NodeData = {
  A: { class_type: 'InputImage', inputs: {}, _meta: { title: 'A' } },
  B: { class_type: 'Process', inputs: { image: ['A', 0] }, _meta: { title: 'B' } },
  C: { class_type: 'Output', inputs: { result: ['B', 0] }, _meta: { title: 'C' } }
};

describe('PromptBuilder robustness', () => {
  it('detects missing output mapping', () => {
    const pb = new PromptBuilder<'img','final', NodeData>(baseWorkflow, ['img'], ['final']);
    pb.setRawInputNode('img', 'A');
    // Intentionally do not set output mapping
    expect(() => pb.validateOutputMappings()).toThrow(/Unmapped/);
  });

  it('passes validation when outputs mapped', () => {
    const pb = new PromptBuilder<'img','final', NodeData>(baseWorkflow, ['img'], ['final']);
    const pb2 = pb.setRawInputNode('img','A').setRawOutputNode('final','C');
    expect(() => pb2.validateOutputMappings()).not.toThrow();
  });

  it('detects invalid output node id', () => {
    const pb = new PromptBuilder<'img','final', NodeData>(baseWorkflow, ['img'], ['final']);
    const pb2 = pb.setRawInputNode('img','A').setRawOutputNode('final','Z'); // Z does not exist
    expect(() => pb2.validateOutputMappings()).toThrow(/Z/);
  });

  it('detects immediate self-cycle', () => {
    const cyc: NodeData = {
      X: { class_type: 'Loop', inputs: { again: ['X', 0] }, _meta: { title: 'X' } }
    };
    const pb = new PromptBuilder<'in','out', NodeData>(cyc, ['in'], ['out']);
    pb.setRawInputNode('in','X').setRawOutputNode('out','X');
    expect(() => pb.validateNoImmediateCycles()).toThrow(/self-cycle/);
  });

  it('serialization round trip preserves mappings & bypass', () => {
    const pb = new PromptBuilder<'img','final', NodeData>(baseWorkflow, ['img'], ['final'])
      .setRawInputNode('img','A')
      .setRawOutputNode('final','C')
      .bypass('B');
    const json = pb.toJSON();
    const restored = PromptBuilder.fromJSON<'img','final', NodeData>(json);
    expect(restored.mapInputKeys.img).toBe('A');
    expect(restored.mapOutputKeys.final).toBe('C');
    expect(restored.bypassNodes).toContain('B');
  });
});
