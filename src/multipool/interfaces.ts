export interface PoolEvent {
  type: string;
  payload: any;
}

export interface MultiWorkflowPoolOptions {
  connectionTimeoutMs?: number;
  enableMonitoring?: boolean;
  monitoringIntervalMs?: number;
}