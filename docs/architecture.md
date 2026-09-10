# Architecture

## Request flow

1. The HTTP server authenticates `/v1/*`, limits the request body, and parses JSON.
2. The protocol layer validates the supported Chat Completions subset.
3. Messages, inline tool definitions, and tool policy are rendered as a JSON transcript.
4. A per-request JSON Schema constrains Claude to a text response or offered function calls.
5. Claude Code runs with its tools and customizations disabled.
6. The validated `structured_output` is converted into a Chat Completion or buffered SSE chunks.

## Components

- `src/server.mjs`: HTTP routing, bearer authentication, limits, JSON errors, and SSE framing.
- `src/protocol.mjs`: OpenAI request validation, Claude prompt/schema creation, and response translation.
- `src/claude-cli.mjs`: Claude Code process isolation, timeout handling, and output-envelope parsing.
- `src/service.mjs`: concurrency control and completion orchestration.
- `src/session-store.mjs`: explicit session reuse, history-prefix validation, TTL, and per-session serialization.

## Trust boundaries

The proxy treats HTTP requests and model output as untrusted. It validates request shape, limits input and captured output sizes, constrains tool names, and never executes tools.

Claude Code is a trusted local executable. Its child process inherits the proxy environment for authentication. The proxy disables Claude Code customizations and tools so repository instructions, user plugins, and configured MCP servers do not enter the model-backend request.

## Why there is no MCP bridge

The proxy only needs Claude to choose a function and produce arguments. Claude Code's structured-output feature provides a validated answer channel directly. An MCP recorder would add a second process, mutable files, concurrency hazards, and tool lifecycle behavior without adding execution capability.

## Session model

OpenAI Chat Completions has no standard conversation identifier. Inferring identity from message text can merge unrelated users. The proxy therefore runs statelessly unless the caller supplies `X-Claude-Session-Id`.

For an explicit key, the store records the Claude session ID and a hash chain over messages already consumed. A later request resumes only when that exact prefix is present and at least one new non-assistant message exists. Requests using the same key are serialized.

Stateless requests disable Claude Code session persistence. Opt-in sessions remain in Claude Code's local transcript store after the proxy's in-memory index expires; lifecycle management of that external data remains with the operator.
