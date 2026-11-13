import { dynamicTool, jsonSchema, type Tool } from "ai";
import {
  AyinboxToolError,
  AyinboxToolsClient,
  type AyinboxToolDefinition,
  type AyinboxToolResult,
  type AyinboxToolset,
  type ClientOptions,
} from "./client.js";
import { VERSION } from "./version.js";

export {
  AyinboxApiError,
  AyinboxConnectionError,
  AyinboxToolError,
  AyinboxToolsClient,
  DEFAULT_BASE_URL,
  type AyinboxToolDefinition,
  type AyinboxToolResult,
  type AyinboxToolset,
  type ClientOptions,
} from "./client.js";
export { VERSION };

export const MCP_URL = "https://api.ayinbox.com/v1/mcp";

export interface AyinboxToolsOptions extends ClientOptions {
  /** Ask the API for these toolsets only (`GET /ai/tools?toolsets=`). */
  toolsets?: readonly AyinboxToolset[];
  /** Keep only tools with these names. */
  include?: readonly string[];
  /** Drop tools with these names. Applied after `include`. */
  exclude?: readonly string[];
}

/** A record of AI SDK tools keyed by AY Inbox tool name, ready for `generateText({ tools })`. */
export type AyinboxToolSet = Record<string, Tool<unknown, AyinboxToolResult>>;

function inputSchemaOf(def: AyinboxToolDefinition): Record<string, unknown> {
  const schema = def.input_schema && typeof def.input_schema === "object" ? def.input_schema : {};
  return { type: "object", properties: {}, ...schema };
}

/** Narrows a tool list by name, keeping the API's order. */
export function filterTools(
  tools: readonly AyinboxToolDefinition[],
  options: { include?: readonly string[]; exclude?: readonly string[] },
): AyinboxToolDefinition[] {
  const include = options.include ? new Set(options.include) : undefined;
  const exclude = new Set(options.exclude ?? []);
  return tools.filter((t) => (!include || include.has(t.name)) && !exclude.has(t.name));
}

/**
 * Fetches the tools this credential may call (`GET /ai/tools`, once) and turns each into an
 * AI SDK tool whose `execute` runs `POST /ai/tools/{name}/call`.
 */
export async function ayinboxTools(options: AyinboxToolsOptions = {}): Promise<AyinboxToolSet> {
  const client = new AyinboxToolsClient({ ...options, userAgent: `ayinbox-ai-sdk/${VERSION}` });
  const definitions = filterTools(await client.listTools({ toolsets: options.toolsets }), options);

  const tools: AyinboxToolSet = {};
  for (const def of definitions) {
    tools[def.name] = dynamicTool({
      description: def.description,
      inputSchema: jsonSchema(inputSchemaOf(def) as Parameters<typeof jsonSchema>[0]),
      execute: async (input, { abortSignal }) => {
        try {
          return await client.callTool(def.name, input, { signal: abortSignal });
        } catch (err) {
          if (abortSignal?.aborted) throw err;
          throw new AyinboxToolError(def.name, err);
        }
      },
      // The model reads result_text, which the API fences as data when people outside the workspace wrote it.
      toModelOutput: ({ output }) => ({
        type: "text",
        value: (output as AyinboxToolResult).result_text,
      }),
    }) as Tool<unknown, AyinboxToolResult>;
  }
  return tools;
}

/**
 * Settings for the AI SDK MCP client (`createMCPClient` from `@ai-sdk/mcp`) pointed at the
 * AY Inbox MCP server, as an alternative to `ayinboxTools`.
 */
export function ayinboxMcp(options: { apiKey?: string; url?: string } = {}): {
  transport: { type: "http"; url: string; headers: Record<string, string> };
} {
  const apiKey = options.apiKey ?? process.env.AYINBOX_API_KEY;
  if (!apiKey) throw new Error("No AY Inbox credential: pass apiKey or set AYINBOX_API_KEY.");
  return {
    transport: {
      type: "http",
      url: options.url ?? MCP_URL,
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  };
}
