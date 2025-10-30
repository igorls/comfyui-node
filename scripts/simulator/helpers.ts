import type { ComfyApi } from "../../src/index.ts";

// ANSI color codes for terminal output
const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m"
};

export function log(color: keyof typeof COLORS | string, ...args: any[]) {
  // eslint-disable-next-line no-console
  const colorCode = COLORS[color as keyof typeof COLORS] || COLORS.reset;
  console.log(`${colorCode}[${new Date().toISOString()}]`, ...args, COLORS.reset);
}

export function randomInt(min: number, max: number) {
  const floorMin = Math.ceil(min);
  const floorMax = Math.floor(max);
  return Math.floor(Math.random() * (floorMax - floorMin + 1)) + floorMin;
}

export function pickRandom<T>(list: T[]): T {
  return list[randomInt(0, list.length - 1)];
}

export function clone<T>(obj: T): T {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(obj);
  }
  return JSON.parse(JSON.stringify(obj));
}

export function isMissingModelError(error: any): boolean {
  const message = String(error?.message || error);
  const detailBlob = JSON.stringify(error?.bodyJSON ?? error ?? {});
  return (
    /model/i.test(message) ||
    /checkpoint/i.test(message) ||
    /not found/i.test(message) ||
    /value_not_in_list/i.test(detailBlob) ||
    /ckpt_name/i.test(detailBlob)
  );
}

export async function uploadImage(imageUrl: string, uploadName: string, client: ComfyApi) {
  const fetchFn = globalThis.fetch?.bind(globalThis);
  if (!fetchFn) {
    throw new Error("fetch is not available in this runtime");
  }
  const response = await fetchFn(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch generated image: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const blob = new Blob([arrayBuffer]);
  await client.ext.file.uploadImage(blob, uploadName, { override: true });
}

export function nextSeed(seedStrategy: "random" | "auto" | "fixed") {
  if (seedStrategy === "auto") return -1;
  if (seedStrategy === "fixed") return 42;
  return randomInt(0, 2_147_483_647);
}
