import type { WorkflowJobPayload } from "../types/job.js";

export interface QueueStats {
  waiting: number;
  inFlight: number;
  delayed: number;
  failed: number;
}

export interface QueueReservation {
  /** Unique reservation identifier (often equals the jobId for in-memory implementation). */
  reservationId: string;
  payload: WorkflowJobPayload;
  attempt: number;
  /** Optional timestamp when the item becomes visible again (for delayed retries). */
  availableAt?: number;
}

export interface QueueAdapter {
  enqueue(payload: WorkflowJobPayload, opts?: { priority?: number; delayMs?: number }): Promise<void>;
  reserve(): Promise<QueueReservation | null>;
  commit(reservationId: string): Promise<void>;
  retry(reservationId: string, opts?: { delayMs?: number }): Promise<void>;
  discard(reservationId: string, reason?: unknown): Promise<void>;
  remove(jobId: string): Promise<boolean>;
  stats(): Promise<QueueStats>;
  shutdown(): Promise<void>;
}
