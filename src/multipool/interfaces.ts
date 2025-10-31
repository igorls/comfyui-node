import { LogLevel } from "./logger.js";

/**
 * Pool event emitted through PoolEventManager
 * All ComfyUI client events are forwarded with the prefix "client:"
 */
export interface PoolEvent {
  type: string;
  payload: any;
}

/**
 * Client event payload forwarded from ComfyUI WebSocket events
 */
export interface ClientEventPayload {
  /** URL of the client that emitted the event */
  clientUrl: string;
  /** Node name of the client */
  clientName: string;
  /** Original ComfyUI event type (status, progress, executing, etc.) */
  eventType: string;
  /** Original event data from ComfyUI */
  eventData: any;
}

export interface MultiWorkflowPoolOptions {
  connectionTimeoutMs?: number;
  enableMonitoring?: boolean;
  monitoringIntervalMs?: number;
  logLevel?: LogLevel;
  enableProfiling?: boolean;
}