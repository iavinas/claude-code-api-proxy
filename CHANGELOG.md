# Changelog

All notable changes will be documented here.

## 0.1.0 - 2026-09-10

### Added

- OpenAI-compatible Chat Completions and model-list endpoints.
- Text, function tool-call, named tool-choice, parallel-call, and buffered SSE responses.
- Claude Code structured-output integration with tools and customizations disabled.
- Optional bearer authentication, body and output limits, concurrency limits, and graceful shutdown.
- Automatic, prefix-verified Claude session reuse with delta-only follow-up prompts, cold fallback, and explicit conversation-key overrides.
- Unit, HTTP, fake-process integration, and opt-in live tests.
