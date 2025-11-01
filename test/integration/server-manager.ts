/**
 * Server Manager Utilities
 *
 * Provides utilities for spawning and managing mock server processes
 * in integration tests. Allows starting servers, killing them,
 * and restarting them to simulate real server disconnections.
 */

import { spawn, ChildProcess } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ServerInstance {
  process: ChildProcess;
  port: number;
  pid: number | undefined;
  url: string;
  wsUrl: string;
}

export interface ServerManagerOptions {
  port?: number;
  startupTimeout?: number;
  shutdownTimeout?: number;
}

export class ServerManager {
  private servers: Map<number, ServerInstance> = new Map();
  private readonly defaultPort: number = 8188;
  private readonly startupTimeout: number;
  private readonly shutdownTimeout: number;

  constructor(options: ServerManagerOptions = {}) {
    this.defaultPort = options.port || 8188;
    this.startupTimeout = options.startupTimeout || 5000;
    this.shutdownTimeout = options.shutdownTimeout || 3000;
  }

  /**
   * Start a mock server on the specified port
   */
  async startServer(port?: number): Promise<ServerInstance> {
    const serverPort = port || this.defaultPort;

    // Check if server is already running on this port
    if (this.servers.has(serverPort)) {
      throw new Error(`Server already running on port ${serverPort}`);
    }

    const mockServerPath = resolve(__dirname, "mock-server.ts");

    // Spawn the server process
    const serverProcess = spawn("bun", [mockServerPath, serverPort.toString()], {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      detached: false,
      env: {
        ...process.env,
        NODE_ENV: "test",
      },
    });

    const instance: ServerInstance = {
      process: serverProcess,
      port: serverPort,
      pid: serverProcess.pid,
      url: `http://localhost:${serverPort}`,
      wsUrl: `ws://localhost:${serverPort}/ws`,
    };

    this.servers.set(serverPort, instance);

    // Set up output handlers
    serverProcess.stdout?.on("data", (data) => {
      console.log(`[Server ${serverPort}] ${data.toString().trim()}`);
    });

    serverProcess.stderr?.on("data", (data) => {
      console.error(`[Server ${serverPort}] ERROR: ${data.toString().trim()}`);
    });

    serverProcess.on("exit", (code, signal) => {
      console.log(`[Server ${serverPort}] Process exited with code ${code}, signal ${signal}`);
      this.servers.delete(serverPort);
    });

    // Wait for server to be ready
    await this.waitForServerReady(instance);

    return instance;
  }

  /**
   * Wait for server to signal it's ready
   */
  private async waitForServerReady(instance: ServerInstance): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Server failed to start within ${this.startupTimeout}ms`));
      }, this.startupTimeout);

      const messageHandler = (message: any) => {
        if (message === "ready") {
          clearTimeout(timeout);
          instance.process.off("message", messageHandler);
          resolve();
        }
      };

      const errorHandler = (err: Error) => {
        clearTimeout(timeout);
        instance.process.off("message", messageHandler);
        instance.process.off("error", errorHandler);
        reject(err);
      };

      const exitHandler = (code: number | null) => {
        clearTimeout(timeout);
        instance.process.off("message", messageHandler);
        instance.process.off("error", errorHandler);
        instance.process.off("exit", exitHandler);
        reject(new Error(`Server process exited with code ${code} before becoming ready`));
      };

      instance.process.on("message", messageHandler);
      instance.process.on("error", errorHandler);
      instance.process.once("exit", exitHandler);
    });
  }

  /**
   * Kill a server running on the specified port
   */
  async killServer(port?: number): Promise<void> {
    const serverPort = port || this.defaultPort;
    const instance = this.servers.get(serverPort);

    if (!instance) {
      throw new Error(`No server running on port ${serverPort}`);
    }

    return this.killServerInstance(instance);
  }

  /**
   * Kill a specific server instance
   */
  private async killServerInstance(instance: ServerInstance): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!instance.process || instance.process.killed) {
        this.servers.delete(instance.port);
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        // Force kill if graceful shutdown fails
        console.log(`[Server ${instance.port}] Force killing process`);
        instance.process.kill("SIGKILL");
        this.servers.delete(instance.port);
        resolve();
      }, this.shutdownTimeout);

      instance.process.once("exit", () => {
        clearTimeout(timeout);
        this.servers.delete(instance.port);
        resolve();
      });

      instance.process.once("error", (err) => {
        clearTimeout(timeout);
        this.servers.delete(instance.port);
        reject(err);
      });

      // Send SIGTERM for graceful shutdown
      console.log(`[Server ${instance.port}] Sending SIGTERM to process ${instance.pid}`);
      instance.process.kill("SIGTERM");
    });
  }

  /**
   * Restart a server (kill and start again)
   */
  async restartServer(port?: number, delayMs: number = 0): Promise<ServerInstance> {
    const serverPort = port || this.defaultPort;

    // Kill existing server
    if (this.servers.has(serverPort)) {
      await this.killServer(serverPort);
    }

    // Wait for specified delay
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    // Start new server
    return this.startServer(serverPort);
  }

  /**
   * Kill all running servers
   */
  async killAll(): Promise<void> {
    const instances = Array.from(this.servers.values());
    const promises = instances.map((instance) => this.killServerInstance(instance));

    await Promise.allSettled(promises);
    this.servers.clear();
  }

  /**
   * Get server instance by port
   */
  getServer(port?: number): ServerInstance | undefined {
    const serverPort = port || this.defaultPort;
    return this.servers.get(serverPort);
  }

  /**
   * Check if server is running on port
   */
  isRunning(port?: number): boolean {
    const serverPort = port || this.defaultPort;
    const instance = this.servers.get(serverPort);
    return instance !== undefined && !instance.process.killed;
  }

  /**
   * Get all running servers
   */
  getAllServers(): ServerInstance[] {
    return Array.from(this.servers.values());
  }

  /**
   * Wait for a server to stop (for testing)
   */
  async waitForServerStop(port?: number, timeoutMs: number = 5000): Promise<void> {
    const serverPort = port || this.defaultPort;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Server on port ${serverPort} did not stop within ${timeoutMs}ms`));
      }, timeoutMs);

      const checkInterval = setInterval(() => {
        if (!this.servers.has(serverPort)) {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }
}

/**
 * Helper function to create a server manager and start a server
 */
export async function startMockServer(port?: number): Promise<{
  manager: ServerManager;
  server: ServerInstance;
}> {
  const manager = new ServerManager({ port });
  const server = await manager.startServer(port);
  return { manager, server };
}

/**
 * Helper function to simulate server downtime and recovery
 */
export async function simulateServerDowntime(
  manager: ServerManager,
  port: number,
  downtimeMs: number
): Promise<ServerInstance> {
  console.log(`[Simulation] Killing server on port ${port}`);
  await manager.killServer(port);

  console.log(`[Simulation] Server down for ${downtimeMs}ms`);
  await new Promise((resolve) => setTimeout(resolve, downtimeMs));

  console.log(`[Simulation] Restarting server on port ${port}`);
  return manager.startServer(port);
}
