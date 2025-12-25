export { ComfyApi } from "./client.js";
export type { ConnectionState } from "./client.js";
export { CallWrapper } from "./call-wrapper.js";
export { ComfyPool, EQueueMode } from "./pool.js";
export { WorkflowPool, MemoryQueueAdapter, SmartFailoverStrategy } from "./pool/index.js";
export { PromptBuilder } from "./prompt-builder.js";
export { Workflow, WorkflowJob } from "./workflow.js";
export type { AugmentNodes, SamplerName, SchedulerName } from "./node-type-hints.js";
export type { WorkflowResult, WorkflowResultMeta } from "./workflow.js";
export type { WorkflowAffinity } from "./pool/types/affinity.js";
// Type-only re-exports so Bun/ESM runtime doesn't attempt to resolve value exports for type aliases
export type { TSamplerName, TSchedulerName } from "./types/sampler.js";
export type {
  TComfyAPIEventMap,
  TComfyPoolEventMap,
  ComfyApiEventKey,
  ComfyPoolEventKey,
  TEventStatus,
  TExecution,
  TExecuting,
  TProgress,
  TExecuted,
  TExecutionCached,
  TExecutionError,
  TExecutionInterrupted
} from "./types/event.js";
export type {
  WorkflowPoolEventMap,
  WorkflowPoolOpts,
  JobRecord,
  JobStatus as PoolJobStatus,
  WorkflowJobOptions,
  QueueAdapter,
  QueueReservation,
  QueueStats,
  FailoverStrategy,
  JobProfileStats,
  NodeExecutionProfile
} from "./pool/index.js";
export { seed } from "./tools.js";

// Model loading detection utilities
export {
  isModelLoadingNode,
  workflowContainsModelLoading,
  getModelLoadingNodes,
  estimateModelLoadingTime,
  estimateWorkflowModelLoadingTime,
  getTimeoutMultiplierForModelLoading,
  MODEL_LOADING_NODE_TYPES,
  MODEL_LOADING_TIME_ESTIMATES
} from "./utils/model-loading.js";
export type { StorageType } from "./utils/model-loading.js";

// MultiWorkflowPool exports
export { MultiWorkflowPool } from "./multipool/index.js";
export { Workflow as MultiWorkflow } from "./multipool/workflow.js";
export type { PoolEvent, ClientEventPayload, MultiWorkflowPoolOptions, SubmitJobOptions } from "./multipool/interfaces.js";
export type { JobResults, JobState, JobStatus as MultiJobStatus, JobResultStatus } from "./multipool/interfaces.js";
export type { JobProfileStats as MultiJobProfileStats } from "./multipool/interfaces.js";

// Jobs API exports (ComfyUI v0.6.0+)
export { JobsFeature } from "./features/jobs.js";
export {
  JobStatus,
  type Job,
  type JobsListResponse,
  type JobsListOptions,
  type JobsPagination,
  type JobOutputPreview,
  type JobExecutionError,
  type JobWorkflow
} from "./types/api.js";
