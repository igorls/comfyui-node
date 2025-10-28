import type { ManagedClient } from "../client/ClientManager.js";
import type { JobRecord } from "../types/job.js";
import type { FailoverStrategy } from "./Strategy.js";

interface WorkflowFailureState {
  blockedUntil: number;
  failureCount: number;
}

export class SmartFailoverStrategy implements FailoverStrategy {
  private workflowFailures: Map<string, Map<string, WorkflowFailureState>> = new Map();
  private cooldownMs: number;
  private maxFailuresBeforeBlock: number;

  constructor(opts?: { cooldownMs?: number; maxFailuresBeforeBlock?: number }) {
    this.cooldownMs = opts?.cooldownMs ?? 60_000;
    this.maxFailuresBeforeBlock = opts?.maxFailuresBeforeBlock ?? 1;
  }

  shouldSkipClient(client: ManagedClient, job: JobRecord): boolean {
    const workflowMap = this.workflowFailures.get(client.id);
    if (!workflowMap) {
      return false;
    }
    const entry = workflowMap.get(job.workflowHash);
    if (!entry) {
      return false;
    }
    if (entry.blockedUntil > Date.now()) {
      return true;
    }
    workflowMap.delete(job.workflowHash);
    return false;
  }

  recordFailure(client: ManagedClient, job: JobRecord, error: unknown): void {
    let workflowMap = this.workflowFailures.get(client.id);
    if (!workflowMap) {
      workflowMap = new Map();
      this.workflowFailures.set(client.id, workflowMap);
    }
    const existing = workflowMap.get(job.workflowHash);
    const failureCount = (existing?.failureCount ?? 0) + 1;
    const blocked = failureCount >= this.maxFailuresBeforeBlock;
    workflowMap.set(job.workflowHash, {
      failureCount,
      blockedUntil: blocked ? Date.now() + this.cooldownMs : Date.now()
    });
  }

  recordSuccess(client: ManagedClient, job: JobRecord): void {
    const workflowMap = this.workflowFailures.get(client.id);
    if (!workflowMap) {
      return;
    }
    workflowMap.delete(job.workflowHash);
    if (workflowMap.size === 0) {
      this.workflowFailures.delete(client.id);
    }
  }

  resetForWorkflow(workflowHash: string): void {
    for (const [, map] of Array.from(this.workflowFailures)) {
      map.delete(workflowHash);
    }
  }

  isWorkflowBlocked(client: ManagedClient, workflowHash: string): boolean {
    const workflowMap = this.workflowFailures.get(client.id);
    if (!workflowMap) {
      return false;
    }
    const entry = workflowMap.get(workflowHash);
    if (!entry) {
      return false;
    }
    return entry.blockedUntil > Date.now();
  }
}
