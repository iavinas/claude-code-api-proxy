import { spawn } from 'node:child_process';

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_SCHEMA_BYTES = 100_000;
const SYSTEM_PROMPT = [
  'You are the language model behind an OpenAI-compatible Chat Completions endpoint.',
  'The prompt contains a JSON transcript. Respect its message roles and tool policy.',
  'Never infer personal data from the Claude Code account or local environment; use only the supplied transcript and tool results.',
  'Do not use external tools. Return only the requested structured output.',
].join(' ');

export class ClaudeCliError extends Error {
  constructor(message, code = 'cli_error') {
    super(message);
    this.name = 'ClaudeCliError';
    this.code = code;
  }
}

export function buildClaudeArgs(options) {
  const schema = JSON.stringify(options.schema);
  if (Buffer.byteLength(schema) > MAX_SCHEMA_BYTES) throw new ClaudeCliError('The generated output schema is too large.', 'invalid_schema');
  const args = [
    '-p', '--output-format', 'json', '--json-schema', schema,
    '--model', options.model,
    '--safe-mode', '--strict-mcp-config', '--no-chrome',
    '--permission-mode', 'dontAsk', '--tools', '',
    '--system-prompt', SYSTEM_PROMPT,
    '--system-prompt-snapshot', 'on',
  ];
  addSessionArgs(args, options.session);
  return args;
}

function addSessionArgs(args, session) {
  if (!session) {
    args.push('--no-session-persistence');
    return;
  }
  args.push(session.resume ? '--resume' : '--session-id', session.id);
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new ClaudeCliError('Claude Code did not return valid JSON.', 'invalid_output');
  }
}

function errorCode(text) {
  if (/json-schema|invalid schema/i.test(text)) return 'invalid_schema';
  if (/not logged in|please run \/login|invalid api key|authentication_error|oauth/i.test(text)) return 'authentication_error';
  if (/session|resume/i.test(text) && /not found|in use|invalid|failed/i.test(text)) return 'session_error';
  return 'cli_error';
}

export function parseClaudeEnvelope(stdout, stderr = '', exitCode = 0) {
  if (!stdout.trim() && exitCode !== 0) throwCliError(stderr);
  const envelope = parseJson(stdout.trim());
  const detail = [envelope.result, stderr].filter(Boolean).join(' ').trim();
  if (envelope.is_error || exitCode !== 0) {
    const code = errorCode(detail);
    const message = code === 'authentication_error' ? 'Claude Code authentication is required.' : 'Claude Code reported an error.';
    throw new ClaudeCliError(message, code);
  }
  if (!envelope.structured_output || typeof envelope.structured_output !== 'object') {
    throw new ClaudeCliError('Claude Code returned no structured output.', 'invalid_output');
  }
  return envelope;
}

function throwCliError(detail) {
  const code = errorCode(detail);
  const messages = {
    authentication_error: 'Claude Code authentication is required.',
    invalid_schema: 'Claude Code rejected the output schema.',
  };
  throw new ClaudeCliError(messages[code] ?? 'Claude Code reported an error.', code);
}

function appendOutput(state, field, chunk) {
  if (state.settled) return;
  state[field] += chunk;
  if (Buffer.byteLength(state[field]) <= MAX_OUTPUT_BYTES) return;
  stopProcess(state, new ClaudeCliError(`Claude Code ${field} exceeded the output limit.`, 'output_too_large'));
}

function settleProcess(state, error, result) {
  if (state.settled) return;
  state.settled = true;
  clearTimeout(state.timer);
  state.options.signal?.removeEventListener('abort', state.abort);
  if (error) state.reject(error); else state.resolve(result);
}

function stopProcess(state, error) {
  if (state.settled) return;
  state.child.kill('SIGTERM');
  state.killTimer = setTimeout(() => {
    if (state.options.active.has(state.child)) state.child.kill('SIGKILL');
  }, 1_000);
  state.killTimer.unref();
  settleProcess(state, error);
}

function closeProcess(state, code) {
  clearTimeout(state.killTimer);
  state.options.active.delete(state.child);
  settleProcess(state, null, { stderr: state.stderr, stdout: state.stdout, exitCode: code ?? 1 });
}

function attachProcessListeners(state) {
  state.child.stdout.on('data', (chunk) => appendOutput(state, 'stdout', chunk));
  state.child.stderr.on('data', (chunk) => appendOutput(state, 'stderr', chunk));
  state.child.on('error', (error) => settleProcess(state, new ClaudeCliError(error.message, error.code === 'ENOENT' ? 'not_found' : 'cli_error')));
  state.child.on('close', (code) => closeProcess(state, code));
  state.child.stdin.on('error', (error) => {
    if (error.code !== 'EPIPE') settleProcess(state, new ClaudeCliError(error.message));
  });
}

function startProcess(context) {
  const { command, args, options } = context;
  const child = options.spawnImpl(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const state = { ...context, abort: null, child, killTimer: null, settled: false, stderr: '', stdout: '', timer: null };
  options.active.add(child);
  state.abort = () => stopProcess(state, new ClaudeCliError('Request was aborted.', 'request_aborted'));
  state.timer = setTimeout(() => stopProcess(state, new ClaudeCliError('Claude Code timed out.', 'timeout')), options.timeoutMs);
  options.signal?.addEventListener('abort', state.abort, { once: true });
  attachProcessListeners(state);
  if (options.signal?.aborted) state.abort(); else child.stdin.end(options.input);
}

function runProcess(command, args, options) {
  return new Promise((resolve, reject) => startProcess({ command, args, options, reject, resolve }));
}

export function createClaudeRunner(config, dependencies = {}) {
  const active = new Set();
  const spawnImpl = dependencies.spawn ?? spawn;
  return {
    async run(request) {
      if (request.signal?.aborted) throw new ClaudeCliError('Request was aborted.', 'request_aborted');
      const args = buildClaudeArgs(request);
      const result = await runProcess(config.claudePath, args, {
        active,
        input: request.prompt,
        signal: request.signal,
        spawnImpl,
        timeoutMs: config.timeoutMs,
      });
      return parseClaudeEnvelope(result.stdout, result.stderr, result.exitCode);
    },
    close() {
      for (const child of active) child.kill('SIGTERM');
    },
  };
}

export async function getClaudeVersion(claudePath = 'claude', dependencies = {}) {
  const active = new Set();
  const result = await runProcess(claudePath, ['--version'], {
    active,
    input: '',
    spawnImpl: dependencies.spawn ?? spawn,
    timeoutMs: 5_000,
  });
  if (result.exitCode !== 0 || !result.stdout.trim()) throw new ClaudeCliError('Claude Code CLI is unavailable.', 'not_found');
  return result.stdout.trim();
}
