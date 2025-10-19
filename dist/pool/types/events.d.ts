import type { TypedEventTarget } from "../../typed-event-target.js";
import type { JobRecord } from "./job.js";
export interface WorkflowPoolEventMap extends Record<string, CustomEvent<any>> {
    "pool:ready": CustomEvent<{
        clientIds: string[];
    }>;
    "pool:error": CustomEvent<{
        error: unknown;
    }>;
    "job:queued": CustomEvent<{
        job: JobRecord;
    }>;
    "job:accepted": CustomEvent<{
        job: JobRecord;
    }>;
    "job:started": CustomEvent<{
        job: JobRecord;
    }>;
    "job:progress": CustomEvent<{
        jobId: string;
        clientId: string;
        progress: any;
    }>;
    "job:preview": CustomEvent<{
        jobId: string;
        clientId: string;
        blob: Blob;
    }>;
    "job:preview_meta": CustomEvent<{
        jobId: string;
        clientId: string;
        payload: {
            blob: Blob;
            metadata: any;
        };
    }>;
    "job:output": CustomEvent<{
        jobId: string;
        clientId: string;
        key: string;
        data: any;
    }>;
    "job:completed": CustomEvent<{
        job: JobRecord;
    }>;
    "job:failed": CustomEvent<{
        job: JobRecord;
        willRetry: boolean;
    }>;
    "job:cancelled": CustomEvent<{
        job: JobRecord;
    }>;
    "job:retrying": CustomEvent<{
        job: JobRecord;
        delayMs: number;
    }>;
    "client:state": CustomEvent<{
        clientId: string;
        online: boolean;
        busy: boolean;
        lastError?: unknown;
    }>;
    "client:blocked_workflow": CustomEvent<{
        clientId: string;
        workflowHash: string;
    }>;
    "client:unblocked_workflow": CustomEvent<{
        clientId: string;
        workflowHash: string;
    }>;
}
export type WorkflowPoolEventTarget = TypedEventTarget<WorkflowPoolEventMap>;
export type WorkflowPoolEventName = keyof WorkflowPoolEventMap;
export type WorkflowPoolListener<K extends WorkflowPoolEventName> = (event: WorkflowPoolEventMap[K]) => void;
//# sourceMappingURL=events.d.ts.map