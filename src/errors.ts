/**
 * JSON-RPC 2.0 error codes used by MCP.
 * https://www.jsonrpc.org/specification#error_object
 */
export const JSON_RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export type JsonRpcErrorCode =
  (typeof JSON_RPC_ERROR_CODES)[keyof typeof JSON_RPC_ERROR_CODES];

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: null;
  error: JsonRpcErrorObject;
}

/** Build a JSON-RPC 2.0 error response body. */
export function toJsonRpcErrorBody(
  code: number,
  message: string,
  data?: unknown,
): JsonRpcErrorResponse {
  const error: JsonRpcErrorObject = { code, message };
  if (data !== undefined) {
    error.data = data;
  }
  return { jsonrpc: "2.0", id: null, error };
}

/** Build a `Response` carrying a JSON-RPC 2.0 error body. */
export function toJsonRpcErrorResponse(
  status: number,
  code: number,
  message: string,
  data?: unknown,
): Response {
  return new Response(JSON.stringify(toJsonRpcErrorBody(code, message, data)), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
