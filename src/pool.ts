import { TComfyPoolEventMap } from "./types/event";
import { ComfyApi } from "./client";
import { delay } from "./tools";

interface JobItem {
  weight: number;
  /**
   * Only one of the following clientIds will be picked.
   */
  includeClientIds?: string[];
  /**
   * The following clientIds will be excluded from the picking list.
   */
  excludeClientIds?: string[];
  fn: (api: ComfyApi, clientIdx?: number) => Promise<void>;
  /**
   * Optional error handler invoked if the job cannot be started (e.g. timeout acquiring client).
   */
  onError?: (err: any) => void;
}

/**
 * Represents the mode for picking clients from a queue.
 *
 * - "PICK_ZERO": Picks the client which has zero queue remaining. This is the default mode. (For who using along with ComfyUI web interface)
 * - "PICK_LOWEST": Picks the client which has the lowest queue remaining.
 * - "PICK_ROUTINE": Picks the client in a round-robin manner.
 */
export enum EQueueMode {
  /**
   * Picks the client which has zero queue remaining. This is the default mode. (For who using along with ComfyUI web interface)
   */
  "PICK_ZERO",
  /**
   * Picks the client which has the lowest queue remaining.
   */
  "PICK_LOWEST",
  /**
   * Picks the client in a round-robin manner.
   */
  "PICK_ROUTINE"
}

export class ComfyPool extends EventTarget {
  public clients: ComfyApi[] = [];
  private clientStates: Array<{
    id: string;
    queueRemaining: number;
    locked: string | boolean;
    online: boolean;
  }> = [];

  private mode: EQueueMode = EQueueMode.PICK_ZERO;
  private jobQueue: Array<JobItem> = [];
  private routineIdx: number = 0;
  private listeners: {
    event: keyof TComfyPoolEventMap;
    options?: AddEventListenerOptions | boolean;
    handler: (event: TComfyPoolEventMap[keyof TComfyPoolEventMap]) => void;
  }[] = [];
  private readonly maxQueueSize: number = 1000;
  private poolMonitoringInterval: any;
  private claimTimeoutMs: number = -1;

  constructor(
    clients: ComfyApi[],
    /**
     * The mode for picking clients from the queue. Defaults to "PICK_ZERO".
     */
    mode: EQueueMode = EQueueMode.PICK_ZERO,
    opts?: {
      /**
       * The maximum size of the job queue. Defaults to 1000.
       */
      maxQueueSize?: number;
      /**
       * Optional timeout (ms) while waiting for a free / acceptable client. -1 disables timeout (default).
       */
      claimTimeoutMs?: number;
    }
  ) {
    super();
    this.mode = mode;

    if (opts && typeof opts.maxQueueSize === "number") {
      if (opts.maxQueueSize < 0) {
        throw new Error("maxQueueSize cannot be negative");
      }
      this.maxQueueSize = opts.maxQueueSize;
    }
    if (typeof opts?.claimTimeoutMs === "number") {
      this.claimTimeoutMs = opts.claimTimeoutMs;
    }

    this.poolMonitoringInterval = setInterval(() => {
      this.processJobQueue().catch((err) => {
        console.error("[ComfyPool] Error processing job queue:", err);
      });
    }, 5000);

    this.initPool(clients).then(() => {
      this.dispatchEvent(new CustomEvent("init"));
    }).catch(reason => {
      console.error("[ComfyPool] Error initializing pool:", reason);
      this.dispatchEvent(new CustomEvent("error", { detail: reason }));
    });
  }

  async initPool(clients: ComfyApi[]) {
    for (const client of clients) {
      await this.addClient(client);
    }
    await this.processJobQueue();
  }

  public on<K extends keyof TComfyPoolEventMap>(
    type: K,
    callback: (event: TComfyPoolEventMap[K]) => void,
    options?: AddEventListenerOptions | boolean
  ) {
    this.addEventListener(type, callback as any, options);
    this.listeners.push({ event: type, handler: callback, options });
    return this;
  }

  public off<K extends keyof TComfyPoolEventMap>(
    type: K,
    callback: (event: TComfyPoolEventMap[K]) => void,
    options?: EventListenerOptions | boolean
  ) {
    this.removeEventListener(type, callback as any, options);
    this.listeners = this.listeners.filter((listener) => listener.event !== type && listener.handler !== callback);
    return this;
  }

  /**
   * Removes all event listeners from the pool.
   */
  public removeAllListeners() {
    this.listeners.forEach((listener) => {
      this.removeEventListener(listener.event, listener.handler, listener.options);
    });
    this.listeners = [];
  }

  /**
   * Adds a client to the pool.
   *
   * @param client - The client to be added.
   * @returns Promise<void>
   */
  async addClient(client: ComfyApi) {
    const index = this.clients.push(client) - 1;
    this.clientStates.push({
      id: client.id,
      queueRemaining: 0,
      locked: false,
      online: false
    });
    await this.initializeClient(client, index);
    this.dispatchEvent(new CustomEvent("added", { detail: { client, clientIdx: index } }));
  }

  /**
   * Destroys the pool and all its clients.
   * Ensures all connections, timers and event listeners are properly closed.
   */
  destroy() {

    // Cancel any pending jobs
    this.jobQueue = [];

    // Destroy all clients properly and ensure they're cleaned up
    this.clients.forEach((client, index) => {
      try {
        client.destroy();
      } catch (e) {
        console.error(`[ComfyPool] Error destroying client ${client.id}:`, e);
      }
    });

    // Clear arrays
    this.clients = [];
    this.clientStates = [];

    // Remove all event listeners
    this.removeAllListeners();

    if (this.poolMonitoringInterval) {
      clearInterval(this.poolMonitoringInterval);
      this.poolMonitoringInterval = undefined;
    }
  }

  /**
   * Removes a client from the pool.
   *
   * @param client - The client to be removed.
   * @returns void
   */
  removeClient(client: ComfyApi): void {
    const index = this.clients.indexOf(client);
    this.removeClientByIndex(index);
  }

  /**
   * Removes a client from the pool by its index.
   *
   * @param index - The index of the client to remove.
   * @returns void
   * @fires removed - Fires a "removed" event with the removed client and its index as detail.
   */
  removeClientByIndex(index: number): void {
    if (index >= 0 && index < this.clients.length) {
      const client = this.clients.splice(index, 1)[0];
      client.destroy();
      this.clientStates.splice(index, 1);
      this.dispatchEvent(new CustomEvent("removed", { detail: { client, clientIdx: index } }));
    }
  }

  /**
   * Changes the mode of the queue.
   *
   * @param mode - The new mode to set for the queue.
   * @returns void
   */
  changeMode(mode: EQueueMode): void {
    this.mode = mode;
    this.dispatchEvent(new CustomEvent("change_mode", { detail: { mode } }));
  }

  /**
   * Picks a ComfyApi client from the pool based on the given index.
   *
   * @param idx - The index of the client to pick. Defaults to 0 if not provided.
   * @returns The picked ComfyApi client.
   */
  pick(idx: number = 0): ComfyApi {
    return this.clients[idx];
  }

  /**
   * Retrieves a `ComfyApi` object from the pool based on the provided ID.
   * @param id - The ID of the `ComfyApi` object to retrieve.
   * @returns The `ComfyApi` object with the matching ID, or `undefined` if not found.
   */
  pickById(id: string): ComfyApi | undefined {
    return this.clients.find((c) => c.id === id);
  }

  /**
   * Executes a job using the provided client and optional client index.
   *
   * @template T The type of the result returned by the job.
   * @param {Function} job The job to be executed.
   * @param {number} [weight] The weight of the job.
   * @param {Object} [clientFilter] An object containing client filtering options.
   * @param {Object} [options] Additional options for job execution.
   * @returns {Promise<T>} A promise that resolves with the result of the job.
   */
  run<T>(
    job: (client: ComfyApi, clientIdx?: number) => Promise<T>,
    weight?: number,
    clientFilter?: {
      /**
       * Only one of the following clientIds will be picked.
       */
      includeIds?: string[];
      /**
       * The following clientIds will be excluded from the picking list.
       */
      excludeIds?: string[];
    },
    options?: {
      /**
       * Whether to enable automatic failover to other clients when one fails.
       * Defaults to true.
       */
      enableFailover?: boolean;
      /**
       * Maximum number of retry attempts on different clients.
       * Defaults to the number of available clients.
       */
      maxRetries?: number;
      /**
       * Delay between retry attempts in milliseconds.
       * Defaults to 1000ms.
       */
      retryDelay?: number;
    }
  ): Promise<T> {
    const enableFailover = options?.enableFailover !== false; // Default to true
    const retryDelay = options?.retryDelay || 1000;

    return new Promise<T>(async (resolve, reject) => {
      let excludedIds = clientFilter?.excludeIds ? [...clientFilter.excludeIds] : [];
      let attempt = 0;
      const onlineClients = this.clientStates.filter((c) => c.online);
      const maxRetries = options?.maxRetries || onlineClients.length;
      let lastError: any = null;

      const tryExecute = async (): Promise<void> => {
        attempt++;

        const fn = async (client: ComfyApi, idx?: number) => {
          this.dispatchEvent(new CustomEvent("executing", { detail: { client, clientIdx: idx } }));
          try {
            const result = await job(client, idx);
            this.dispatchEvent(new CustomEvent("executed", { detail: { client, clientIdx: idx } }));
            resolve(result);
          } catch (e) {
            lastError = e;
            console.error(`[ComfyPool] Job failed on client ${client.id} (attempt ${attempt}/${maxRetries}):`, e);

            // If failover is enabled and we have more attempts, exclude this client and retry
            if (enableFailover && attempt < maxRetries && onlineClients.length > excludedIds.length) {
              excludedIds.push(client.id);
              this.dispatchEvent(
                new CustomEvent("execution_error", {
                  detail: { client, clientIdx: idx, error: e, willRetry: true, attempt, maxRetries }
                })
              );

              // Wait before retrying
              setTimeout(() => {
                tryExecute().catch(reject);
              }, retryDelay);
            } else {
              // No more retries or failover disabled, reject with the error
              this.dispatchEvent(
                new CustomEvent("execution_error", {
                  detail: { client, clientIdx: idx, error: e, willRetry: false, attempt, maxRetries }
                })
              );
              reject(e);
            }
          }
        };

        try {
          await this.claim(fn, weight, {
            includeIds: clientFilter?.includeIds,
            excludeIds: excludedIds
          }, (err) => {
            // onError from claim (e.g. timeout acquiring client)
            lastError = err;
            reject(err);
          });
        } catch (claimError) {
          reject(lastError || claimError);
        }
      };

      // Start the first attempt
      tryExecute().catch(reject);
    });
  }

  /**
   * Executes a batch of asynchronous jobs concurrently and returns an array of results.
   *
   * @template T - The type of the result returned by each job.
   * @param jobs - An array of functions that represent the asynchronous jobs to be executed.
   * @param weight - An optional weight value to assign to each job.
   * @param clientFilter - An optional object containing client filtering options.
   * @returns A promise that resolves to an array of results, in the same order as the jobs array.
   */
  batch<T>(
    jobs: Array<(client: ComfyApi, clientIdx?: number) => Promise<T>>,
    weight?: number,
    clientFilter?: {
      /**
       * Only one of the following clientIds will be picked.
       */
      includeIds?: string[];
      /**
       * The following clientIds will be excluded from the picking list.
       */
      excludeIds?: string[];
    }
  ): Promise<T[]> {
    return Promise.all(jobs.map((task) => this.run(task, weight, clientFilter)));
  }

  private async initializeClient(client: ComfyApi, index: number) {
    this.dispatchEvent(
      new CustomEvent("loading_client", {
        detail: { client, clientIdx: index }
      })
    );
    const states = this.clientStates[index];
    client.on("status", (ev) => {
      if (states.online === false) {
        this.dispatchEvent(new CustomEvent("connected", { detail: { client, clientIdx: index } }));
      }
      states.online = true;
      if (ev.detail.status.exec_info && ev.detail.status.exec_info.queue_remaining !== states.queueRemaining) {
        if (ev.detail.status.exec_info.queue_remaining > 0) {
          this.dispatchEvent(
            new CustomEvent("have_job", {
              detail: { client, remain: states.queueRemaining }
            })
          );
        }
        if (ev.detail.status.exec_info.queue_remaining === 0) {
          this.dispatchEvent(new CustomEvent("idle", { detail: { client } }));
        }
      }
      states.queueRemaining = ev.detail.status.exec_info.queue_remaining;
      if (this.mode !== EQueueMode.PICK_ZERO) {
        states.locked = false;
      }
    });
    client.on("terminal", (ev) => {
      this.dispatchEvent(
        new CustomEvent("terminal", {
          detail: {
            clientIdx: index,
            ...ev.detail
          }
        })
      );
    });
    client.on("disconnected", () => {
      states.online = false;
      states.locked = false;
      this.dispatchEvent(
        new CustomEvent("disconnected", {
          detail: { client, clientIdx: index }
        })
      );
    });
    client.on("reconnected", () => {
      states.online = true;
      states.locked = false;
      this.dispatchEvent(
        new CustomEvent("reconnected", {
          detail: { client, clientIdx: index }
        })
      );
    });
    client.on("execution_success", (ev) => {
      states.locked = false;
    });
    client.on("execution_interrupted", (ev) => {
      states.locked = false;
      this.dispatchEvent(
        new CustomEvent("execution_interrupted", {
          detail: {
            client,
            clientIdx: index
          }
        })
      );
    });
    client.on("execution_error", (ev) => {
      states.locked = false;
      this.dispatchEvent(
        new CustomEvent("execution_error", {
          detail: {
            client,
            clientIdx: index,
            error: new Error(ev.detail.exception_type, { cause: ev.detail })
          }
        })
      );
    });
    client.on("queue_error", (ev) => {
      states.locked = false;
    });
    client.on("auth_error", (ev) => {
      this.dispatchEvent(
        new CustomEvent("auth_error", {
          detail: { client, clientIdx: index, res: ev.detail }
        })
      );
    });
    client.on("auth_success", (ev) => {
      this.dispatchEvent(
        new CustomEvent("auth_success", {
          detail: { client, clientIdx: index }
        })
      );
    });
    client.on("connection_error", (ev) => {
      this.dispatchEvent(
        new CustomEvent("connection_error", {
          detail: { client, clientIdx: index, res: ev.detail }
        })
      );
    });
    /**
     * Wait for the client to be ready before start using it
     * Note: init() now returns the client instance and sets isReady=true internally
     */
    await client.init();

    // No need to call waitForReady() as init() already does that
    this.bindClientSystemMonitor(client, index);
    this.dispatchEvent(new CustomEvent("ready", { detail: { client, clientIdx: index } }));
  }

  private async bindClientSystemMonitor(client: ComfyApi, index: number) {
    if (client.ext.monitor.isSupported) {
      client.ext.monitor.on("system_monitor", (ev) => {
        this.dispatchEvent(
          new CustomEvent("system_monitor", {
            detail: {
              client,
              data: ev.detail,
              clientIdx: index
            }
          })
        );
      });
    }
  }

  private pushJobByWeight(item: JobItem): number {
    const idx = this.jobQueue.findIndex((job) => job.weight > item.weight);
    if (idx === -1) {
      return this.jobQueue.push(item);
    } else {
      this.jobQueue.splice(idx, 0, item);
      return idx;
    }
  }

  private async claim(
    fn: (client: ComfyApi, clientIdx?: number) => Promise<void>,
    weight?: number,
    clientFilter?: {
      includeIds?: string[];
      excludeIds?: string[];
    },
    onError?: (err: any) => void
  ): Promise<void> {
    if (this.jobQueue.length >= this.maxQueueSize) {
      throw new Error("Job queue limit reached");
    }
    const inputWeight = weight === undefined ? this.jobQueue.length : weight;
    const idx = this.pushJobByWeight({
      weight: inputWeight,
      fn,
      excludeClientIds: clientFilter?.excludeIds,
      includeClientIds: clientFilter?.includeIds,
      onError
    });
    this.dispatchEvent(
      new CustomEvent("add_job", {
        detail: { jobIdx: idx, weight: inputWeight }
      })
    );
    await this.processJobQueue();
  }

  private async getAvailableClient(includeIds?: string[], excludeIds?: string[], timeout = -1): Promise<ComfyApi> {
    let tries = 1;
    const start = Date.now();
    while (true) {
      if (timeout > 0 && Date.now() - start > timeout) {
        throw new Error("Timeout waiting for an available client");
      }
      if (tries < 100) tries++;
      let index = -1;
      const acceptedClients = this.clientStates.filter((c) => {
        if (!c.online) return false;
        if (includeIds && includeIds.length > 0) {
          return includeIds.includes(c.id);
        }
        if (excludeIds && excludeIds.length > 0) {
          return !excludeIds.includes(c.id);
        }
        return true;
      });
      switch (this.mode) {
        case EQueueMode.PICK_ZERO:
          index = acceptedClients.findIndex((c) => c.queueRemaining === 0 && !c.locked && c.id);
          break;
        case EQueueMode.PICK_LOWEST:
          const queueSizes = acceptedClients.map((state) =>
            state.online ? state.queueRemaining : Number.MAX_SAFE_INTEGER
          );
          index = queueSizes.indexOf(Math.min(...queueSizes));
          break;
        case EQueueMode.PICK_ROUTINE:
          index = this.routineIdx++ % acceptedClients.length;
          this.routineIdx = this.routineIdx % acceptedClients.length;
          break;
      }
      if (index !== -1 && acceptedClients[index]) {
        const trueIdx = this.clientStates.findIndex((c) => c.id === acceptedClients[index].id);
        this.clientStates[trueIdx].locked = true;
        return this.clients[trueIdx];
      }
      await delay(Math.min(tries * 10));
    }
  }

  private async processJobQueue(): Promise<void> {

    if (this.jobQueue.length === 0) {
      return;
    }

    while (this.jobQueue.length > 0) {
      const job = this.jobQueue.shift();
      if (!job) continue;
      try {
        const client = await this.getAvailableClient(job.includeClientIds, job.excludeClientIds, this.claimTimeoutMs);
        const clientIdx = this.clients.indexOf(client);
        await job.fn(client, clientIdx);
      } catch (error) {
        console.error("[ComfyPool] Error processing job:", error);
        try {
          job?.onError?.(error);
        } catch { }
      }
    }

  }

  private async pickJob(): Promise<void> {
    while (true) {
      console.log("[ComfyPool] Picking job...");
      if (this.jobQueue.length === 0) {
        await delay(100);
        continue;
      }
      const job = this.jobQueue.shift();
      const client = await this.getAvailableClient(job?.includeClientIds, job?.excludeClientIds);
      const clientIdx = this.clients.indexOf(client);
      job?.fn?.(client, clientIdx);
    }
  }
}

// Test-only helpers (non-breaking; ignored at runtime usage)
export const __TEST_ONLY__ = {
  snapshotQueue(pool: ComfyPool) {
    return (pool as any).jobQueue.map((j: any) => ({ weight: j.weight, include: j.includeClientIds, exclude: j.excludeClientIds }));
  }
};
