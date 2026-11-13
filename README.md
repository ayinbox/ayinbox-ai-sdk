# @ayinbox/ai-sdk

AY Inbox tools for the [Vercel AI SDK](https://ai-sdk.dev). One call loads every agent tool your AY Inbox credential allows and hands them to `generateText`, `streamText` or an agent as ordinary AI SDK tools.

AY Inbox is a hosted cold email platform. It warms mailboxes, sends cold email at a paced daily volume and brings every reply into one inbox, where Aya, its AI assistant, drafts the answer from the campaign brain and offers a meeting time.

AY Inbox is a hosted service. This repository holds the AI SDK tool adapter for its REST API. The service itself is not open source.

Access to the hosted service is invite only for now: ask at team@ayinbox.com.

## How it works

The tool catalogue lives on the API, so this package hard-codes no tools. `ayinboxTools()` calls `GET /v1/ai/tools` once with your credential, which answers with only the tools that credential may call, each with a JSON Schema for its input. Every tool becomes an AI SDK tool whose `execute` runs `POST /v1/ai/tools/{name}/call`. New tools on the API appear without a package update.

## Install

Not on npm yet. Install from GitHub today:

```bash
npm install github:ayinbox/ayinbox-ai-sdk ai
```

npm builds the package from source on install (its `prepare` script).

Once it is published, the command will be `npm install @ayinbox/ai-sdk ai`.

Requirements: Node.js 20 or later, and `ai` 6 or 7 as a peer dependency (`ai` 7 itself needs Node.js 22).

## Quick start

```ts
import { generateText, isStepCount } from "ai";
import { ayinboxTools } from "@ayinbox/ai-sdk";

const tools = await ayinboxTools({ toolsets: ["inbox"] }); // reads AYINBOX_API_KEY

const { text } = await generateText({
  model: "your-provider/your-model",
  tools,
  stopWhen: isStepCount(8),
  prompt: "Summarise my unread replies and draft an answer to the newest one.",
});
```

With `ai` 6, use `stepCountIs(8)` in place of `isStepCount(8)`.

A runnable version is in [`examples/agent.ts`](examples/agent.ts): it lists campaigns, reads the newest unread thread and drafts a reply, with the model left to your environment.

What each tool returns:

- `execute` resolves to `{ name, result, result_text, untrusted }`, the API's answer. `result` is the tool's output as JSON for your own code.
- The model is given `result_text` (through `toModelOutput`). When `untrusted` is true, the API has already fenced that text as data, because it holds mail or form answers written by people outside your workspace.
- A failed call throws an `AyinboxToolError`, which the AI SDK hands to the model as a tool error. Its message names the API's `code` and `request_id`, for example `AY Inbox tool list_campaigns failed: insufficient API key permissions (status 403, code forbidden, request_id 4bbb...)`. It never contains your key.

## Options

```ts
ayinboxTools({
  apiKey,    // aybox_ API key or ayat_ OAuth token. Default: AYINBOX_API_KEY
  baseUrl,   // default https://api.ayinbox.com/v1, then AYINBOX_BASE_URL
  toolsets,  // ask the API for these toolsets only
  include,   // keep only these tool names
  exclude,   // drop these tool names (applied after include)
  timeoutMs, // per attempt, default 30000
  maxRetries,// default 2, 0 disables
  fetch,     // your own fetch implementation
});
```

- `toolsets` is any of `inbox`, `campaigns`, `contacts`, `leads`, `crm`, `mailboxes`, `workspace`, `automation`, `forms`, `developer`, `research` and `analytics`. It is sent as `?toolsets=`, and an unknown name is refused by the API with `400 toolset_unknown`. A small model does best with `["inbox"]`.
- `include` and `exclude` filter by tool name on the client, from what the list returned. A name your credential cannot use is simply absent.
- `ayinboxTools` throws an `AyinboxApiError` (with `status`, `code`, `requestId`, `retryAfter`) or an `AyinboxConnectionError` when the list itself cannot be loaded.

Retries: the list is retried on `429`, `502`, `503`, `504` and network errors, honouring `Retry-After`, with exponential backoff and jitter. A tool call is retried on the same answers because every attempt carries one idempotency key: the model's own `idempotency_key` argument when it gave one, otherwise a generated `Idempotency-Key` header reused on each retry. The API then replays the first result instead of running the tool again. `500` and `409 idempotency_outcome_unknown` are never retried.

`AyinboxToolsClient` is exported too, with `listTools()` and `callTool()`, for code that wants the two routes without the AI SDK wrapper.

## Which key to use

The list only ever holds what the credential may call, so the scopes on the key decide what the model can do.

- Use the **Agent: read and draft** key preset (`84574239`) for a model that reads the inbox: every read scope plus `AI_DRAFT`, with nothing that writes or sends. Create it in the dashboard at https://app.ayinbox.com.
- Add write scopes only for the tools you mean to give the model, and narrow the list with `include`.
- A key limited to certain mailboxes is refused by `GET /ai/tools` with `403 api_key_mailbox_limited`, because tools act across the workspace.

Scopes and the tool each one opens are in the [permissions reference](https://docs.ayinbox.com/api/permissions/).

## Calls that send email

No tool on this surface sends an individual email: send-class tools are never listed. Some tools and API calls still lead to real mail, so read this before giving a model write scopes.

- These calls put real email on the wire:
  - Starting a campaign (`POST /campaigns/{id}/start`) needs `START_CAMPAIGNS` or `SEND_CAMPAIGNS`. The `set_campaign_status` tool starts a campaign only with one of those two, and pauses one with `WRITE_CAMPAIGNS`, `START_CAMPAIGNS` or `SEND_CAMPAIGNS`.
  - Updating a campaign to `status: "active"` (and `completed` or `paused_undeliverable`) needs `START_CAMPAIGNS` or `SEND_CAMPAIGNS` in addition to `WRITE_CAMPAIGNS`.
  - Resuming a lead on a finished campaign needs `START_CAMPAIGNS` or `SEND_CAMPAIGNS`.
  - Replying in Unibox (`POST /unibox/reply`) and approving an agent draft need `WRITE_UNIBOX`. A key with `WRITE_UNIBOX` can send replies from any mailbox it can reach.
  - `POST /unibox/compose`, `POST /emails/{id}/send`, `POST /campaigns/{id}/test-email`, the first-email review queue (`/campaigns/{id}/reviews/...`) and placement tests need `SEND_CAMPAIGNS` (compose needs `WRITE_UNIBOX`).
- Adding contacts can send mail without calling start: contacts added to an `active` campaign are queued, a `completed` campaign starts again on its own when leads are added, and a contact that comes to match a segment linked to a sending campaign is enrolled.
- `START_CAMPAIGNS` starts, resumes and pauses campaigns and nothing else. `SEND_CAMPAIGNS` covers everything `START_CAMPAIGNS` covers plus the other sending actions. `WRITE_CAMPAIGNS` alone edits drafts and pauses, and cannot start anything.
- A key for a model that reads the inbox should use the "Agent: read and draft" preset (`84574239`): every read scope plus `AI_DRAFT`, with nothing that writes or sends.
- Some calls spend workspace credits (AI drafts, research, enrichment, paid tools). They answer `402 insufficient_credits` when the balance is out. Paid tools such as `generate_reply_draft` also require an `idempotency_key` argument.
- Retrying a send without an idempotency key can send twice. Pass an idempotency key on every mutating call you might retry. This package sends one on every tool call for you.

## The MCP alternative

AY Inbox also runs an MCP server at `https://api.ayinbox.com/v1/mcp` (streamable HTTP) with the same tools and the same credential. The AI SDK can connect to it with `@ai-sdk/mcp`; `ayinboxMcp()` builds the settings:

```ts
import { createMCPClient } from "@ai-sdk/mcp";
import { generateText } from "ai";
import { ayinboxMcp } from "@ayinbox/ai-sdk";

const mcp = await createMCPClient(ayinboxMcp()); // reads AYINBOX_API_KEY
try {
  const tools = await mcp.tools();
  const { text } = await generateText({ model: "your-provider/your-model", tools, prompt: "..." });
} finally {
  await mcp.close();
}
```

Use `ayinboxTools()` when you want plain HTTP, client-side filtering and `result_text` handed to the model; use MCP when the rest of your stack already speaks it.

## Links

- Agent tools over REST: https://docs.ayinbox.com/api/agent-tools/
- MCP server: https://docs.ayinbox.com/api/mcp/
- Permissions: https://docs.ayinbox.com/api/permissions/
- Agent guide: https://ayinbox.com/skill.md
- Docs: https://docs.ayinbox.com
- Security: [SECURITY.md](SECURITY.md)

## License

MIT. See [LICENSE](LICENSE).
