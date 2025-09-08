import type { TSamplerName, TSchedulerName } from './types/sampler.js';

/**
 * Provide intellisense for officially enumerated sampler / scheduler names
 * while permitting forward-compatible arbitrary strings.
 */
export type SamplerName = TSamplerName | (string & {});
export type SchedulerName = TSchedulerName | (string & {});

// Generic augmentation utilities used by Workflow.fromAugmented
type WithAugmentedSamplerInputs<N> = N extends { class_type: infer C; inputs: infer I }
  ? C extends 'KSampler'
    ? I extends Record<string, any>
      ? Omit<I, 'sampler_name' | 'scheduler'> & {
          sampler_name?: SamplerName;
          scheduler?: SchedulerName;
        }
      : I
    : I
  : never;

export type AugmentNode<N> = N extends { class_type: 'KSampler'; inputs: any }
  ? { class_type: 'KSampler'; inputs: WithAugmentedSamplerInputs<N> }
  : N;

export type AugmentNodes<T> = { [K in keyof T]: AugmentNode<T[K]> };
