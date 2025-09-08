import { EnqueueFailedError } from "../types/error.js";

/** Extract a diagnostic reason string from arbitrary JSON */
function extractReason(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const maybeRecord = json as Record<string, unknown>;
  const direct = (maybeRecord as any).error || (maybeRecord as any).message || (maybeRecord as any).detail;
  if (direct && typeof direct === "string") return direct;
  if (Array.isArray((maybeRecord as any).errors) && (maybeRecord as any).errors.length) {
    const first = (maybeRecord as any).errors[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object") {
      return first.message || first.error || JSON.stringify(first).slice(0, 200);
    }
  }
  return undefined;
}

export async function buildEnqueueFailedError(resp: Response): Promise<EnqueueFailedError> {
  let bodyJSON: unknown;
  let bodyTextSnippet: string | undefined;
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      bodyJSON = await resp.clone().json();
    } catch {}
  }
  if (!bodyJSON) {
    try {
      const text = await resp.clone().text();
      bodyTextSnippet = text.slice(0, 500);
    } catch {}
  } else {
    bodyTextSnippet = JSON.stringify(bodyJSON).slice(0, 500);
  }

  const reason = extractReason(bodyJSON) || bodyTextSnippet;
  return new EnqueueFailedError("Failed to queue prompt", {
    cause: bodyJSON || resp,
    status: resp.status,
    statusText: resp.statusText,
  url: (resp as any).url,
  method: (resp as any).method,
    bodyJSON,
    bodyTextSnippet,
    reason
  });
}

export function normalizeUnknownError(e: unknown): EnqueueFailedError {
  if (e instanceof EnqueueFailedError) return e;
  if (e && typeof e === "object" && 'response' in e && (e as any).response instanceof Response) {
    // This path should be awaited by caller with buildEnqueueFailedError, so just return a placeholder
    return new EnqueueFailedError("Failed to queue prompt", { cause: e });
  }
  const reason = (e as any)?.message;
  return new EnqueueFailedError("Failed to queue prompt", { cause: e as any, reason });
}