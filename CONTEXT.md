# Project context

- Claude Code `--json-schema` returns validated data in the JSON envelope's `structured_output` field. The regular `result` field can be empty.
- Claude Code 2.1.260 accepts the proxy's nested `anyOf` tool-call schema; this was verified before authentication was attempted.
- An authentication failure can exit with code 1 while the envelope has `subtype: "success"`; always check `is_error` and the process exit code.
- `--bare` makes logged-out checks fail immediately but also disables OAuth/keychain authentication. The proxy deliberately uses `--safe-mode` instead so both CLI login and API-key authentication remain available.
- OpenAI function definitions belong to each Chat Completions request. Do not use a shared `tools.json` or calls file as cross-process state.
- Chat Completions has no standard conversation identifier. Session reuse is therefore opt-in through `X-Claude-Session-Id`; stateless execution is the default.
- Claude Code must remain a model backend. Keep customizations and built-in tools disabled, and never execute caller-supplied tools in this process.
