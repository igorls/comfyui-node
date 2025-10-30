import { WorkflowAffinity } from "./types/affinity.js";
import { JobId, JobRecord } from "./types/job.js";
import { hashWorkflow } from "src/pool/utils/hash.js";
import { ComfyApi } from "src/client.js";
import { Workflow } from "src/workflow.js";

interface SmartPoolOptions {
  connectionTimeoutMs: number;
}

const DEFAULT_SMART_POOL_OPTIONS: SmartPoolOptions = {
  connectionTimeoutMs: 10000
};

interface PoolEvent {
  type: string;
  promptId: string;
  clientId: string;
  workflowHash: string;
  data?: any;
}

interface ClientQueueState {
  queuedJobs: number;
  runningJobs: number;
}

export class SmartPool {

  // Clients managed by the pool
  clientMap: Map<string, ComfyApi> = new Map();

  // Queue state of pool clients
  clientQueueStates: Map<string, ClientQueueState> = new Map();

  // In-memory store for job records
  jobStore: Map<JobId, JobRecord> = new Map();

  // Affinities mapping workflow hashes to preferred clients
  affinities: Map<string, WorkflowAffinity> = new Map();

  // Pool options
  private options: SmartPoolOptions;

  // Hooks for pool-wide events
  hooks: {
    any?: (event: PoolEvent) => void;
    [key: string]: ((event: PoolEvent) => void) | undefined;
  } = {};

  constructor(clients: (ComfyApi | string)[], options?: Partial<SmartPoolOptions>) {

    if (options) {
      this.options = { ...DEFAULT_SMART_POOL_OPTIONS, ...options };
    } else {
      this.options = DEFAULT_SMART_POOL_OPTIONS;
    }

    for (const client of clients) {
      if (typeof client === "string") {
        const apiClient = new ComfyApi(client);
        this.clientMap.set(apiClient.apiHost, apiClient);
      } else {
        this.clientMap.set(client.apiHost, client);
      }
    }
  }

  emit(event: PoolEvent) {
    if (this.hooks.any) {
      this.hooks.any(event);
    }
    const specificHook = this.hooks[event.type];
    if (specificHook) {
      specificHook(event);
    }
  }

  async connect() {
    const connectionPromises = [];
    const tRefZero = Date.now();
    for (const [url, client] of this.clientMap.entries()) {
      connectionPromises.push(new Promise(async (resolve, reject) => {
        const timeout = setTimeout(() => {
          client.abortReconnect();
          reject(new Error(`Connection to client at ${url} timed out`));
        }, this.options.connectionTimeoutMs);
        try {
          const comfyApi = await client.init(1);
          comfyApi.on("connected", (event: any) => {
            if (event.type === "connected") {
              const tRefDone = Date.now();
              const tDelta = tRefDone - tRefZero;
              console.log(`Client at ${url} (${event.target?.osType}) connected via websockets in ${tDelta} ms`);
              resolve(comfyApi);
            }
          });
        } catch (reason) {
          console.error(`Failed to connect to client at ${url}:`, reason);
          reject(reason);
        } finally {
          clearTimeout(timeout);
        }
      }));
    }
    // Wait for all connection attempts to settle
    const results = await Promise.allSettled(connectionPromises);

    // Check for any rejected connections
    const rejected = results.filter(result => result.status === "rejected");

    // Warn if there are any rejected connections
    if (rejected.length > 0) {
      console.warn(`${rejected.length} client(s) failed to connect.`);
      for (const rejectedClient of rejected) {
        console.warn(`Client rejection reason: ${rejectedClient.reason}`);
      }
    }

    // Sync queue states after connections
    await this.syncQueueStates();

  }

  shutdown() {
    for (const client of this.clientMap.values()) {
      try {
        client.destroy();
      } catch (reason) {
        console.error(`Error shutting down client at ${client.apiHost}:`, reason);
      }
    }
  }

  async syncQueueStates() {
    const promises = Array
      .from(this.clientMap.values())
      .filter(value => value.isReady)
      .map(value => {
        return new Promise(resolve => {
          value.getQueue().then(value1 => {
            console.log(value1);
            this.clientQueueStates.set(value.apiHost, {
              queuedJobs: value1.queue_pending.length,
              runningJobs: value1.queue_running.length
            });
            resolve(true);
          });
        });
      });
    await Promise.allSettled(promises);
    console.log(this.clientQueueStates);
  }

  // Add a job record to the pool
  addJob(jobId: JobId, jobRecord: JobRecord) {
    this.jobStore.set(jobId, jobRecord);
  }

  // Get a job record from the pool
  getJob(jobId: JobId): JobRecord | undefined {
    return this.jobStore.get(jobId);
  }

  // Remove a job record from the pool
  removeJob(jobId: JobId) {
    this.jobStore.delete(jobId);
  }

  // Set the affinity for a workflow
  setAffinity(workflow: object, affinity: Omit<WorkflowAffinity, "workflowHash">) {
    const workflowHash = hashWorkflow(workflow);
    this.affinities.set(workflowHash, {
      workflowHash,
      ...affinity
    });
  }

  // Get the affinity for a workflow
  getAffinity(workflowHash: string): WorkflowAffinity | undefined {
    return this.affinities.get(workflowHash);
  }

  // Remove the affinity for a workflow
  removeAffinity(workflowHash: string) {
    this.affinities.delete(workflowHash);
  }

  async executeImmediate(workflow: Workflow<any>, opts: {
    preferableClientIds?: string[];
  }): Promise<any> {

    const candidateClients: ComfyApi[] = [];
    let workflowHash = workflow.structureHash;

    // Determine candidate clients based on preferred IDs
    if (opts.preferableClientIds && opts.preferableClientIds.length > 0) {
      for (const clientId of opts.preferableClientIds) {
        const client = this.clientMap.get(clientId);
        if (client && client.isReady) {
          candidateClients.push(client);
        }
      }
    } else {
      // Check for affinity based on workflow hash
      console.log(`Looking up affinity for workflow hash: ${workflowHash}`);
      if (workflowHash) {
        const affinity = this.getAffinity(workflowHash);
        if (affinity && affinity.preferredClientIds) {
          for (const clientId of affinity.preferredClientIds) {
            const client = this.clientMap.get(clientId);
            if (client && client.isReady) {
              candidateClients.push(client);
            }
          }
        }
      }
    }

    if (candidateClients.length === 0) {
      // Fallback to any available client
      for (const client of this.clientMap.values()) {
        if (client.isReady) {
          candidateClients.push(client);
        }
      }
    }

    if (candidateClients.length === 0) {
      throw new Error("No available clients match the preferred client IDs");
    }

    // For simplicity, pick the first available candidate client
    const selectedClient = candidateClients[0];

    workflowHash = workflowHash || workflow.structureHash || "";

    this.emit({
      type: "workflow:executeImmediate",
      promptId: "",
      workflowHash,
      clientId: selectedClient.apiHost
    });

    // Execute the workflow immediately on the selected client
    const job = await workflow.run(selectedClient);

    job.on("start", promptId => {
      this.emit({
        type: "job:start",
        promptId,
        workflowHash,
        clientId: selectedClient.apiHost
      });
    });

    job.on("progress", info => {
      this.emit({
        type: "job:progress",
        promptId: info.prompt_id,
        workflowHash,
        clientId: selectedClient.apiHost,
        data: info
      });
    });

    job.on("progress_pct", (pct, info) => {
      this.emit({
        type: "job:progress_pct",
        promptId: info.prompt_id,
        workflowHash,
        clientId: selectedClient.apiHost,
        data: { pct, info }
      });
    });

    job.on("preview_meta", data => {
      this.emit({
        type: "job:preview_meta",
        promptId: data.metadata.prompt_id,
        workflowHash,
        clientId: selectedClient.apiHost,
        data
      });
    });

    job.on("finished", (data, promptId) => {
      this.emit({
        type: "job:finished",
        promptId,
        workflowHash,
        clientId: selectedClient.apiHost,
        data
      });
    });

    const result = await job.done();

    const images = [];

    const aliases = result._aliases || {};
    for (const aliasKey of Object.keys(aliases)) {
      const aliasObject = result[aliases[aliasKey]];
      if (aliasObject && aliasObject.images) {
        images.push(...aliasObject.images);
      }
    }

    // Read images from the client that executed the workflow
    const imageBlob = await selectedClient.ext.file.getImage(images[0]);

    console.log(`Extracted ${images.length} images from workflow result.`);

    console.log(`Workflow executed on client ${selectedClient.apiHost} with: `, result);

    return { ...result, images, imageBlob };
  }


}
