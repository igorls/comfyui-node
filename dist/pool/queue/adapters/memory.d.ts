import { QueueAdapter, QueueReservation, QueueStats } from "../QueueAdapter.js";
import type { WorkflowJobPayload } from "../../types/job.js";
export declare class MemoryQueueAdapter implements QueueAdapter {
    private waiting;
    private inFlight;
    private failed;
    enqueue(payload: WorkflowJobPayload, opts?: {
        priority?: number;
        delayMs?: number;
    }): Promise<void>;
    peek(limit: number): Promise<WorkflowJobPayload[]>;
    reserveById(jobId: string): Promise<QueueReservation | null>;
    reserve(): Promise<QueueReservation | null>;
    commit(reservationId: string): Promise<void>;
    retry(reservationId: string, opts?: {
        delayMs?: number;
    }): Promise<void>;
    discard(reservationId: string, reason?: unknown): Promise<void>;
    remove(jobId: string): Promise<boolean>;
    stats(): Promise<QueueStats>;
    shutdown(): Promise<void>;
}
//# sourceMappingURL=memory.d.ts.map