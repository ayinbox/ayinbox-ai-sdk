# Changelog

## 0.1.0 (unreleased)

- First version: `ayinboxTools()` loads the tools a credential may call from `GET /v1/ai/tools` and turns each into an AI SDK tool that runs `POST /v1/ai/tools/{name}/call`.
- `toolsets`, `include` and `exclude` filtering.
- The model reads `result_text`; API errors become `AyinboxToolError` with the API's `code` and `request_id`.
- Retries on 429, 502, 503, 504 and network errors, with an idempotency key on every tool call.
- `ayinboxMcp()` settings for `@ai-sdk/mcp` and the hosted MCP server.
- Supports `ai` 6 and 7.
