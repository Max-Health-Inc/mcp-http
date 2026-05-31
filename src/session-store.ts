import type { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Session entry holding a live transport + server pair.
 * The transport is kept alive across requests to support
 * server-initiated messages (sampling/createMessage).
 */
export interface SessionEntry {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  createdAt: number;
  lastAccessedAt: number;
}

export interface SessionStoreOptions {
  /**
   * Maximum time (ms) a session is kept alive without activity.
   * Default: 5 minutes.
   */
  ttlMs?: number | undefined;

  /**
   * How often (ms) to sweep expired sessions.
   * Default: 60 seconds.
   */
  sweepIntervalMs?: number | undefined;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_SWEEP_INTERVAL_MS = 60 * 1000; // 1 minute

/**
 * In-memory session store for MCP transports.
 *
 * Maintains transport instances across HTTP requests so that
 * server-initiated RPC (e.g. `createMessage` for sampling) can
 * flow through the persistent SSE connection.
 */
export class SessionStore {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly ttlMs: number;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: SessionStoreOptions) {
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
    const sweepInterval = options?.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;

    // Only start sweep in environments with setInterval (not in tests by default)
    if (typeof setInterval !== "undefined") {
      this.sweepTimer = setInterval(() => {
        this.sweep();
      }, sweepInterval);
      // Unref so the timer doesn't prevent process exit
      if (typeof this.sweepTimer === "object" && "unref" in this.sweepTimer) {
        this.sweepTimer.unref();
      }
    }
  }

  /** Register a new session. */
  set(sessionId: string, entry: SessionEntry): void {
    this.sessions.set(sessionId, entry);
  }

  /** Retrieve a session by ID, updating lastAccessedAt. Returns undefined if expired/missing. */
  get(sessionId: string): SessionEntry | undefined {
    const entry = this.sessions.get(sessionId);
    if (!entry) return undefined;

    if (Date.now() - entry.lastAccessedAt > this.ttlMs) {
      this.close(sessionId);
      return undefined;
    }

    entry.lastAccessedAt = Date.now();
    return entry;
  }

  /** Check if a session exists and is alive. */
  has(sessionId: string): boolean {
    return this.get(sessionId) !== undefined;
  }

  /** Close and remove a session, cleaning up the server. */
  close(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry) {
      this.sessions.delete(sessionId);
      entry.server.close().catch(() => {
        /* cleanup */
      });
    }
  }

  /** Number of active sessions. */
  get size(): number {
    return this.sessions.size;
  }

  /** Remove all expired sessions. */
  sweep(): void {
    const now = Date.now();
    for (const [id, entry] of this.sessions) {
      if (now - entry.lastAccessedAt > this.ttlMs) {
        this.sessions.delete(id);
        entry.server.close().catch(() => {
          /* cleanup */
        });
      }
    }
  }

  /** Shut down the store: close all sessions and stop the sweep timer. */
  destroy(): void {
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    for (const [id] of this.sessions) {
      this.close(id);
    }
  }
}
