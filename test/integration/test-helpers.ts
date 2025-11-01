/**
 * Test Helper Utilities for Integration Tests
 *
 * Provides common helper functions used across integration tests
 * to reduce code duplication and improve test readability.
 */

import { ComfyApi } from "../../src/client";

/**
 * Wait for a client to establish a connection
 * @param api The ComfyApi instance
 * @param timeoutMs Maximum time to wait in milliseconds
 * @returns Promise that resolves when connected or rejects on timeout
 */
export async function waitForConnection(
  api: ComfyApi,
  timeoutMs: number = 10000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Connection timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const check = () => {
      if (api.isConnected()) {
        clearTimeout(timeout);
        resolve();
      } else {
        setTimeout(check, 100);
      }
    };

    check();
  });
}

/**
 * Wait for a client to disconnect
 * @param api The ComfyApi instance
 * @param timeoutMs Maximum time to wait in milliseconds
 * @returns Promise that resolves when disconnected or rejects on timeout
 */
export async function waitForDisconnection(
  api: ComfyApi,
  timeoutMs: number = 5000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Disconnection timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const check = () => {
      if (!api.isConnected()) {
        clearTimeout(timeout);
        resolve();
      } else {
        setTimeout(check, 100);
      }
    };

    check();
  });
}

/**
 * Wait for a specific event to fire
 * @param api The ComfyApi instance
 * @param eventName The event name to wait for
 * @param timeoutMs Maximum time to wait in milliseconds
 * @returns Promise that resolves with the event or rejects on timeout
 */
export async function waitForEvent<T = any>(
  api: ComfyApi,
  eventName: string,
  timeoutMs: number = 5000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      api.removeEventListener(eventName as any, handler);
      reject(new Error(`Event "${eventName}" timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const handler = (event: any) => {
      clearTimeout(timeout);
      api.removeEventListener(eventName as any, handler);
      resolve(event);
    };

    api.addEventListener(eventName as any, handler);
  });
}

/**
 * Sleep for a specified duration
 * @param ms Duration in milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Initialize a client and wait for it to be ready
 * @param api The ComfyApi instance
 * @returns Promise that resolves when initialized
 */
export async function initializeClient(api: ComfyApi): Promise<void> {
  await api.init();
  // Small delay to ensure WebSocket is fully established
  await sleep(100);
}

/**
 * Poll a condition until it becomes true or times out
 * @param condition Function that returns true when condition is met
 * @param timeoutMs Maximum time to wait in milliseconds
 * @param intervalMs Polling interval in milliseconds
 * @returns Promise that resolves when condition is met or rejects on timeout
 */
export async function pollUntil(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number = 10000,
  intervalMs: number = 100
): Promise<void> {
  const startTime = Date.now();

  while (true) {
    const result = await Promise.resolve(condition());
    if (result) {
      return;
    }

    if (Date.now() - startTime >= timeoutMs) {
      throw new Error(`Condition not met within ${timeoutMs}ms`);
    }

    await sleep(intervalMs);
  }
}

/**
 * Create a promise that tracks whether an event fired
 * @param api The ComfyApi instance
 * @param eventName The event name to track
 * @returns Object with a promise and a flag checker
 */
export function trackEvent(
  api: ComfyApi,
  eventName: string
): {
  promise: Promise<any>;
  didFire: () => boolean;
  cleanup: () => void;
} {
  let fired = false;
  let event: any = null;
  let handler: any;

  const promise = new Promise((resolve) => {
    handler = (e: any) => {
      fired = true;
      event = e;
      resolve(e);
    };
    api.addEventListener(eventName as any, handler);
  });

  return {
    promise,
    didFire: () => fired,
    cleanup: () => {
      if (handler) {
        api.removeEventListener(eventName as any, handler);
      }
    },
  };
}
