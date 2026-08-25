import { createMCPClient } from "@ai-sdk/mcp";
import { jsonSchema } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import type { McpHandle } from "./cli.js";

export type McpSession = {
  tools: Awaited<ReturnType<Awaited<ReturnType<typeof createMCPClient>>["tools"]>>;
  serverName: string;
  close: () => Promise<void>;
  connectMs: number;
};

export async function connectMcp(handle: McpHandle, timeoutMs = 5_000): Promise<McpSession> {
  const startedAt = Date.now();
  const client = await withTimeout(
    createMCPClient({
      transport: {
        type: "http",
        url: handle.url,
        headers: { Authorization: `Bearer ${handle.token}` },
      },
      clientName: "gritqa-eval",
      maxRetries: 0,
    }),
    timeoutMs
  );

  const rawTools = await client.tools();
  const tools = portable(rawTools);
  const connectMs = Date.now() - startedAt;

  return {
    tools,
    serverName: (client as unknown as { serverInfo?: { name?: string } }).serverInfo?.name ?? "gritqa",
    close: () => client.close(),
    connectMs,
  };
}

// --- Helpers copied from web/src/lib/agent/research.ts (portable + collapseNullables) ---

type ToolSet = Awaited<ReturnType<Awaited<ReturnType<typeof createMCPClient>>["tools"]>>;

function portable(tools: ToolSet): ToolSet {
  const out: Record<string, unknown> = {};
  for (const [name, tool] of Object.entries(tools)) {
    const t = tool as {
      inputSchema?: { jsonSchema?: JSONSchema7; validate?: unknown };
    };
    const schema = t.inputSchema as { jsonSchema?: JSONSchema7; validate?: unknown } | undefined;
    out[name] =
      schema && typeof schema === "object" && (schema as { jsonSchema?: unknown }).jsonSchema
        ? {
            ...tool,
            inputSchema: jsonSchema(collapseNullables((schema as { jsonSchema: JSONSchema7 }).jsonSchema) as JSONSchema7, {
              validate: (schema as { validate?: Parameters<typeof jsonSchema>[1] extends { validate?: infer V } ? V : never }).validate,
            }),
          }
        : tool;
  }
  return out as ToolSet;
}

function collapseNullables(schema: JSONSchema7): JSONSchema7 {
  if (!schema || typeof schema !== "object") return schema;
  const copy: Record<string, unknown> = { ...schema } as Record<string, unknown>;
  if (Array.isArray(copy.type)) {
    const types = copy.type as string[];
    const nonNull = types.filter((t) => t !== "null");
    if (nonNull.length === 1 && types.includes("null")) copy.type = nonNull[0] as unknown as JSONSchema7["type"];
  }
  for (const key of ["properties", "items", "additionalProperties", "anyOf", "allOf", "oneOf"] as const) {
    const val = copy[key];
    if (!val) continue;
    if (Array.isArray(val)) copy[key] = (val as unknown[]).map((v) => collapseNullables(v as JSONSchema7)) as unknown as typeof val;
    else if (typeof val === "object") {
      if (key === "properties") {
        const props = val as Record<string, JSONSchema7>;
        const next: Record<string, JSONSchema7> = {};
        for (const [k, v] of Object.entries(props)) next[k] = collapseNullables(v);
        copy[key] = next as unknown as typeof val;
      } else {
        copy[key] = collapseNullables(val as JSONSchema7) as unknown as typeof val;
      }
    }
  }
  return copy as JSONSchema7;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`MCP connect timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}
