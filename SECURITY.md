# Security policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Contact the repository maintainers privately and include the affected version, reproduction steps, and potential impact. Maintainers should add a private reporting address or enable GitHub private vulnerability reporting before publishing the repository.

## Deployment guidance

- Keep the default loopback bind address unless a protected network gateway is in front of the proxy.
- Set `CLAUDE_PROXY_API_KEY` before accepting connections from other machines.
- Run the process as an unprivileged operating-system user.
- Keep Claude and proxy credentials out of command-line arguments, logs, source files, and issue reports.
- Do not log prompts or tool arguments without an explicit data-retention policy.
- Claude sessions persist transcripts locally so they can be resumed. Apply an appropriate local transcript-retention policy for sensitive data.
- Send a unique `X-Claude-Session-Id` per conversation when multiple users can submit identical starting prompts.
- Validate every returned tool argument in the application that executes the tool.
- Apply operating-system resource limits when serving untrusted clients.

The proxy never executes tools. A consuming application remains responsible for authorization, confirmation, sandboxing, and validation at its own tool boundary.
