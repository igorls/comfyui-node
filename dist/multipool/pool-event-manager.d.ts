import { MultiWorkflowPool } from "src/multipool/multi-workflow-pool.js";
import { PoolEvent } from "src/multipool/interfaces.js";
export declare class PoolEventManager {
    pool: MultiWorkflowPool;
    hooks: Map<string, Array<Function>>;
    constructor(pool: MultiWorkflowPool);
    attachHook(event: string, listener: (e: PoolEvent) => void): void;
    emitEvent(event: PoolEvent): void;
    detachHook(event: string, listener: (e: PoolEvent) => void): void;
}
//# sourceMappingURL=pool-event-manager.d.ts.map