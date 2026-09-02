// Browser-capability helpers that degrade gracefully on non-secure contexts.
//
// The client is explicitly reachable over plain HTTP at LAN IPs (see lib/links.ts
// and the direct :8009 port). Several Web APIs — crypto.randomUUID and
// navigator.clipboard among them — are ONLY defined in a secure context (HTTPS or
// localhost). Calling them directly throws a TypeError / rejects on http://<lan-ip>,
// which surfaced as failed graph builds, failed "start conversation", and a silently
// dead Copy button. These wrappers fall back so the app works over HTTP too.

import { useCallback, useEffect, useRef } from "react";

/** UUID that works without a secure context.
 *
 * Prefers crypto.randomUUID; otherwise builds a v4 from crypto.getRandomValues
 * (available on plain HTTP, unlike randomUUID) and finally Math.random. These ids
 * are non-security-critical client-side document/conversation handles. */
export function randomId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return (
    hex.slice(0, 4).join("") +
    "-" +
    hex.slice(4, 6).join("") +
    "-" +
    hex.slice(6, 8).join("") +
    "-" +
    hex.slice(8, 10).join("") +
    "-" +
    hex.slice(10, 16).join("")
  );
}

/** Copy text to the clipboard, returning whether it succeeded.
 *
 * navigator.clipboard is undefined over plain HTTP, so the raw call rejects with an
 * unhandled promise rejection. Falls back to the legacy execCommand path and never
 * throws — callers can key their "Copied" feedback off the boolean. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path below
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Schedule a callback like `setTimeout`, but cancelled on unmount and
 * replaced (not stacked) on repeated calls -- for transient UI state like a
 * "Copied!" flash or a status line that clears itself after a couple of
 * seconds. Without this, a still-pending timer firing after the component
 * unmounts calls a state setter on a dead component; in tests specifically,
 * a timer that outlives its test file can fire after Vitest tears down that
 * file's jsdom environment, throwing "ReferenceError: window is not defined"
 * from inside React's own scheduler as an unhandled error (#989). */
export function useAutoClearTimeout(): (fn: () => void, ms: number) => void {
  const idRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (idRef.current !== null) clearTimeout(idRef.current);
    };
  }, []);

  return useCallback((fn: () => void, ms: number) => {
    if (idRef.current !== null) clearTimeout(idRef.current);
    idRef.current = setTimeout(fn, ms);
  }, []);
}
