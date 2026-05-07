/**
 * Fetch utilities for forwarding Bearer tokens to upstream APIs.
 * Pure Web Fetch API — no runtime-specific imports.
 */

/**
 * A `fetch`-compatible function type using only Web Fetch API primitives.
 * Intentionally narrower than `typeof fetch` to stay runtime-agnostic.
 */
export type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Return a `fetch`-compatible function that automatically injects an
 * `Authorization: Bearer <token>` header into every outgoing request,
 * forwarding any existing headers from the caller.
 */
export function forwardBearer(token: string): FetchFn {
  return (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
}
