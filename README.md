# Claude Code API Proxy

A local OpenAI-compatible Chat Completions server backed by the Claude Code CLI.

The proxy accepts OpenAI-shaped messages and function tools, invokes Claude Code as a tool-disabled model backend, and returns OpenAI-shaped text or tool-call responses. It does not execute caller-provided tools.

This is an unofficial community project. It is not affiliated with or endorsed by Anthropic or OpenAI.

## Why this design

Claude Code supports JSON Schema-validated output in print mode. The proxy uses that native output channel instead of asking the model to print JSON-shaped prose.

Tools remain inline in each Chat Completions request. There is no shared `tools.json`, calls file, MCP recorder, polling loop, or forced process termination.

## Requirements

- Node.js 20 or newer.
- A current Claude Code CLI with `--json-schema` support.
- Claude Code authentication through `/login` or `ANTHROPIC_API_KEY`.

This version was developed against Claude Code 2.1.260. Check your installation:

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

Chat Completions requests are stateless by default. To reuse Claude Code's prompt cache, send the same private session key on every turn of one conversation:

```text
X-Claude-Session-Id: 01J8MY-PRIVATE-CONVERSATION-ID
```

The client must still send the complete OpenAI message history. The proxy verifies the history prefix, sends only the new non-assistant messages to the resumed Claude session, serializes requests sharing a key, and expires idle sessions after three hours.

Never reuse a session key between users or unrelated conversations.

Stateless calls use `--no-session-persistence`. Opt-in resumed sessions are persisted by Claude Code in its local configuration directory; the proxy does not delete those transcripts automatically.

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

- `developer`, `system`, `user`, `assistant`, `tool`, and deprecated `function` message roles.
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
