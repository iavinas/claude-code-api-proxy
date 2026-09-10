#!/usr/bin/env node
import { createClaudeRunner, getClaudeVersion } from './claude-cli.mjs';
import { readConfig } from './config.mjs';
import { createCompletionService } from './service.mjs';
import { createProxyServer } from './server.mjs';
import { VERSION } from './version.mjs';

const HELP = `claude-code-api-proxy ${VERSION}

Usage:
  claude-code-api-proxy [options]

Options:
  --host <host>              Bind address (default: 127.0.0.1)
  --port <port>              HTTP port (default: 8901)
  --model <model>            Default Claude model (default: sonnet)
  --claude-path <path>       Claude Code executable (default: claude)
  --timeout-ms <ms>          Per-request timeout (default: 300000)
  --max-body-bytes <bytes>   Request body limit (default: 1048576)
  --max-concurrent <count>   Maximum Claude processes (default: 4)
  --max-sessions <count>     Maximum active sessions (default: 64)
  --session-ttl-ms <ms>      Session idle lifetime (default: 10800000)
  --help                     Show this help
  --version                  Show the version
`;

function listen(server, config) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
}

function shutdown(server, runner) {
  runner.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) return process.stdout.write(HELP);
  if (argv.includes('--version')) return process.stdout.write(`${VERSION}\n`);
  const config = readConfig(argv);
  const claudeVersion = await getClaudeVersion(config.claudePath);
  const runner = createClaudeRunner(config);
  const service = createCompletionService({
    config,
    onTurn: ({ mode, sessionId }) => process.stderr.write(`[claude-proxy] ${mode} session=${sessionId}\n`),
    runner,
  });
  const server = createProxyServer({
    claudeVersion,
    config,
    onError: (error) => process.stderr.write(`[claude-proxy] ${error.stack ?? error}\n`),
    service,
  });
  await listen(server, config);
  process.stderr.write(`[claude-proxy] listening on http://${config.host}:${config.port}/v1 — ${config.model}, Claude Code ${claudeVersion}\n`);
  process.once('SIGINT', () => shutdown(server, runner));
  process.once('SIGTERM', () => shutdown(server, runner));
}

main().catch((error) => {
  process.stderr.write(`[claude-proxy] ${error.message}\n`);
  process.exitCode = 1;
});
