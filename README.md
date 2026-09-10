# Claude Code API Proxy

A local OpenAI-compatible Chat Completions server backed by the Claude Code CLI.

The proxy accepts OpenAI-shaped messages and function tools, invokes Claude Code as a tool-disabled model backend, and returns OpenAI-shaped text or tool-call responses. It does not execute caller-provided tools.

This is an unofficial community project. It is not affiliated with or endorsed by Anthropic or OpenAI.

## Why this design

Claude Code supports JSON Schema-validated output in print mode. The proxy uses that native output channel instead of asking the model to print JSON-shaped prose.

Tools remain inline in each Chat Completions request. There is no shared `tools.json`, calls file, MCP recorder, polling loop, or forced process termination.

Session continuity is a core feature, not an optional optimization. The first turn creates a Claude Code session. Follow-up turns resume it with only the new non-assistant messages, so the existing transcript can be read from Claude's prompt cache instead of uploaded again.

## Requirements

- Node.js 20 or newer.
- A current Claude Code CLI with `--json-schema` support.
- Claude Code authentication through `/login` or `ANTHROPIC_API_KEY`.

This version was developed against Claude Code 2.1.267. Check your installation:

```sh
claude --version
claude --help
```

## Run from source

```sh
npm install
npm test
npm start
```

The server listens on `http://127.0.0.1:8901` by default.

## Text completion

```sh
curl http://127.0.0.1:8901/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "sonnet",
    "messages": [{"role": "user", "content": "Say hello in five words."}]
  }'
```

## Function tool call

```sh
curl http://127.0.0.1:8901/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "sonnet",
    "messages": [{"role": "user", "content": "What is the weather in Pune?"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get weather for a city.",
        "parameters": {
          "type": "object",
          "properties": {"city": {"type": "string"}},
          "required": ["city"],
          "additionalProperties": false
        },
        "strict": true
      }
    }],
    "tool_choice": "auto"
  }'
```

The response contains `choices[0].message.tool_calls`. Your application executes the function and sends its result back as a `tool` message, just as it would with the OpenAI Chat Completions API.

## OpenAI JavaScript client

The OpenAI client is not a dependency of this project. An application that already uses it can point `baseURL` at the proxy:

```js
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.CLAUDE_PROXY_API_KEY || 'local',
  baseURL: 'http://127.0.0.1:8901/v1',
});

const completion = await client.chat.completions.create({
  model: 'sonnet',
  messages: [{ role: 'user', content: 'Hello' }],
});
```

## Session reuse

Session reuse is automatic. The proxy derives an episode key from the requested model, system message, and first user message. It creates the first turn with `--session-id`, then uses `--resume` with a delta prompt on every matching follow-up.

The client must still send the complete OpenAI message history. Before resuming, the proxy verifies a hash chain over the history already consumed. It omits assistant echoes from the delta because those replies already exist in the Claude session. An unchanged tool catalog is omitted too; a changed catalog is sent again.

For multi-user servers or applications where separate conversations can begin with identical prompts, send a stable private conversation key on every turn:

```text
X-Claude-Session-Id: 01J8MY-PRIVATE-CONVERSATION-ID
```

Never reuse a session key between users or unrelated conversations.

Requests sharing an episode key are serialized. Idle mappings expire after three hours. If resume fails, the proxy retries once from the complete history with a newly minted session ID. The process log reports each completion as `cold`, `resumed`, or `cold-fallback`; an unexpectedly all-cold run is a cost warning.

Claude Code persists these sessions in its local configuration directory. The in-memory episode mapping is lost when the proxy restarts, so the next request starts cold. The proxy does not delete Claude's local transcripts automatically.

## Configuration

Command-line options take precedence over environment variables.

| Option | Environment | Default |
|---|---|---:|
| `--host` | `CLAUDE_PROXY_HOST` | `127.0.0.1` |
| `--port` | `CLAUDE_PROXY_PORT` | `8901` |
| `--model` | `CLAUDE_PROXY_MODEL` | `sonnet` |
| `--claude-path` | `CLAUDE_PROXY_CLAUDE_PATH` | `claude` |
| `--timeout-ms` | `CLAUDE_PROXY_TIMEOUT_MS` | `300000` |
| `--max-body-bytes` | `CLAUDE_PROXY_MAX_BODY_BYTES` | `1048576` |
| `--max-concurrent` | `CLAUDE_PROXY_MAX_CONCURRENT` | `4` |
| `--max-sessions` | `CLAUDE_PROXY_MAX_SESSIONS` | `64` |
| `--session-ttl-ms` | `CLAUDE_PROXY_SESSION_TTL_MS` | `10800000` |

Set `CLAUDE_PROXY_API_KEY` to require `Authorization: Bearer ...` on `/v1/*` endpoints. Authentication is strongly recommended before binding to a non-loopback address.

## Compatibility

Supported request behavior:

- `developer`, `system`, `user`, `assistant`, `tool`, and deprecated `function` message roles. OpenAI `system` messages replace the proxy's default Claude Code system prompt.
- String content and arrays containing text parts.
- Function tools, including `strict` schemas.
- `tool_choice`: `none`, `auto`, `required`, a named function, and current `allowed_tools` selectors.
- `parallel_tool_calls`.
- `stream: true`. The SSE response is correctly framed but buffered until Claude finishes.
- `n: 1`.
- `GET /v1/models` and `GET /health`.

Not supported:

- Image, audio, or other multimodal content.
- OpenAI hosted tools or custom free-form tools.
- Multiple choices.
- Sampling, token-limit, log-probability, response-format, and storage controls. Explicit unsupported generation options return an error instead of being silently ignored.
- True token-by-token streaming.

OpenAI notes that non-strict function-call arguments may still be invalid or contain unexpected parameters. Validate arguments before executing any tool. Strict tool schemas are included in Claude Code's structured-output schema.

See [Architecture](docs/architecture.md) for the request flow and trust boundaries.

## Security

Claude Code is launched with safe mode, strict MCP isolation, no Chrome integration, no built-in tools, and a non-interactive permission mode. The prompt is sent on stdin. Arguments are passed directly to the executable without a shell.

The child process inherits the proxy environment so it can access Claude credentials. Do not run untrusted hooks around the proxy process, log request bodies, or expose the server publicly without a separate hardened gateway.

See [SECURITY.md](SECURITY.md) for reporting and deployment guidance.

## Development

```sh
npm run check
npm test
```

The regular suite uses a fake Claude executable and requires no credentials. After configuring temporary Claude credentials, run:

```sh
npm run test:live
```

## License

MIT

## References

- [OpenAI Chat Completions API reference](https://developers.openai.com/api/reference/resources/chat)
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)
