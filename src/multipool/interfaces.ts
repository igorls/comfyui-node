import { LogLevel } from "./logger.js";

export interface PoolEvent {
  type: string;
  payload: any;
}

export interface MultiWorkflowPoolOptions {
  connectionTimeoutMs?: number;
  enableMonitoring?: boolean;
  monitoringIntervalMs?: number;
  logLevel?: LogLevel;
  enableProfiling?: boolean;
}