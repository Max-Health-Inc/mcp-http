import { describe, it, expect } from "bun:test";
import { McpServer } from "@modelcontextprotocol/server";
import { handleMcpPost } from "../src/transport.js";

function makeServer(): McpServer {
  const server = new McpServer({ name: "disconnect", version: "0.0.1" });
  server.registerTool("ping", { description: "ping" }, () =>
    Promise.resolve({ content: [{ type: "text" as const, text: "pong" }] }),
  );
  return server;
}

describe("handleMcpPost — client disconnect", () => {
  it("does not raise an unhandled rejection when the body is cancelled", async () => {
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      seen.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const res = await handleMcpPost({
        server: makeServer(),
        req: new Request("https://api.example.com/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {},
          }),
        }),
      });

      // Without an explicit catch this fires on every disconnected client.
      if (res.body !== null) await res.body.cancel();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(seen).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
