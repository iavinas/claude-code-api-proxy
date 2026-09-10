# Project context

- Claude Code `--json-schema` returns validated data in the JSON envelope's `structured_output` field. The regular `result` field can be empty.
- Claude Code 2.1.267 accepts the proxy's session, structured-output, and system-prompt snapshot flags. Live model behavior still requires credentials.
- An authentication failure can exit with code 1 while the envelope has `subtype: "success"`; always check `is_error` and the process exit code.
- `--bare` makes logged-out checks fail immediately but also disables OAuth/keychain authentication. The proxy deliberately uses `--safe-mode` instead so both CLI login and API-key authentication remain available.
- OpenAI function definitions belong to each Chat Completions request. Do not use a shared `tools.json` or calls file as cross-process state.
- Claude session reuse is the main cost invariant. Derive a default conversation key from the system message plus first user message; let `X-Claude-Session-Id` override it when callers can supply a stronger identity.
- Resume only after the stored message-prefix chain matches. Hash tool calls semantically and exclude generated call IDs, which may change without changing the conversation.
- A resumed prompt contains only new non-assistant messages. Repeat the tool catalog only when it changes.
- Every cold attempt must mint a fresh UUID. Reusing `--session-id` after a failed call can produce `Session ID ... is already in use`.
- Claude Code must remain a model backend. Keep customizations and built-in tools disabled, and never execute caller-supplied tools in this process.
