import { generateText, stepCountIs } from "ai";
import * as aiTest from "ai/test";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ayinboxTools } from "../src/index.js";
import { MockApi, fixture } from "./server.js";

const KEY = "aybox_generateKEYneverLeaks0123456789abcdefghijklm";
const api = new MockApi();

beforeAll(() => api.start());
afterAll(() => api.stop());
afterEach(() => api.reset());

// ai 7 ships MockLanguageModelV4, ai 6 MockLanguageModelV3; their generate results share this shape.
type MockCtor = new (opts: { doGenerate: (opts: { prompt: unknown }) => Promise<unknown> }) => unknown;
const mocks = aiTest as unknown as Record<string, MockCtor | undefined>;
const MockModel = (mocks.MockLanguageModelV4 ?? mocks.MockLanguageModelV3)!;

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

function scriptedModel(prompts: unknown[]) {
  let turn = 0;
  return new MockModel({
    doGenerate: async ({ prompt }) => {
      prompts.push(prompt);
      turn++;
      if (turn === 1) {
        return {
          content: [{ type: "tool-call", toolCallId: "call_1", toolName: "list_campaigns", input: '{"limit":5}' }],
          finishReason: { unified: "tool-calls", raw: "tool_calls" },
          usage,
          warnings: [],
        };
      }
      return {
        content: [{ type: "text", text: "done" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      };
    },
  });
}

describe("generateText with AY Inbox tools", () => {
  it("runs a tool and gives the model result_text", async () => {
    api
      .on("GET", "/v1/ai/tools", { status: 200, body: fixture("ai_tools_list.json") })
      .on("POST", "/v1/ai/tools/list_campaigns/call", { status: 200, body: fixture("ai_tool_call.json") });
    const tools = await ayinboxTools({ apiKey: KEY, baseUrl: api.baseUrl });
    const prompts: unknown[] = [];

    const result = await generateText({
      model: scriptedModel(prompts) as Parameters<typeof generateText>[0]["model"],
      tools,
      stopWhen: stepCountIs(3),
      prompt: "List my campaigns.",
    });

    expect(result.text).toBe("done");
    expect(JSON.parse(api.calls("POST", "/v1/ai/tools/list_campaigns/call")[0]!.body)).toEqual({ limit: 5 });
    const second = JSON.stringify(prompts[1]);
    expect(second).toContain('"type":"text"');
    expect(second).toContain('{\\"campaigns\\":[]}');
  });

  it("reports an API error to the model as a tool error, without the key", async () => {
    api
      .on("GET", "/v1/ai/tools", { status: 200, body: fixture("ai_tools_list.json") })
      .on("POST", "/v1/ai/tools/list_campaigns/call", {
        status: 402,
        body: fixture("errors/402_insufficient_credits.json"),
      });
    const tools = await ayinboxTools({ apiKey: KEY, baseUrl: api.baseUrl });
    const prompts: unknown[] = [];

    const result = await generateText({
      model: scriptedModel(prompts) as Parameters<typeof generateText>[0]["model"],
      tools,
      stopWhen: stepCountIs(3),
      prompt: "List my campaigns.",
    });

    const toolError = result.steps[0]!.content.find((p) => p.type === "tool-error") as
      | { error: unknown }
      | undefined;
    expect(toolError).toBeDefined();
    expect(String((toolError!.error as Error).message)).toContain("code insufficient_credits");
    const second = JSON.stringify(prompts[1]);
    expect(second).toContain("insufficient_credits");
    expect(second).toContain("request_id req-fixture-0001");
    expect(second).not.toContain(KEY);
    expect(JSON.stringify(result.steps)).not.toContain(KEY);
  });
});
