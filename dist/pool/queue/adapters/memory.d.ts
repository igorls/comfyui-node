import { QueueAdapter, QueueReservation, QueueStats } from "../QueueAdapter.js";
import type { WorkflowJobPayload } from "../../types/job.js";
export declare class MemoryQueueAdapter implements QueueAdapter {
    private queuesByCheckpoint;
    private inFlight;
    private failed;
    private nextSequenceNumber;
    private lastDequeuedByCheckpoint;
    enqueue(payload: WorkflowJobPayload, opts?: {
        priority?: number;
        delayMs?: number;
    }): Promise<void>;
    private getCheckpointKey;
    reserve(opts?: {
        availableCheckpoints?: string[];
    }): Promise<QueueReservation | null>;
    /**
     * 🎯 Extrai checkpoints do payload do job
     * Isso permite rastrear FIFO por checkpoint individualmente
     */
    private extractCheckpoints;
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