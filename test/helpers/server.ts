import { McpServer } from "@modelcontextprotocol/server";

export const MODERN_META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
};

export function emptyServer(): McpServer {
  return new McpServer({ name: "test", version: "0.0.1" });
}

export function pingServer(): McpServer {
  const server = emptyServer();
  server.registerTool("ping", { description: "ping" }, () =>
    Promise.resolve({ content: [{ type: "text", text: "pong" }] }),
  );
  return server;
}
