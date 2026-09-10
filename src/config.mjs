const DEFAULTS = {
  apiKey: '',
  claudePath: 'claude',
  host: '127.0.0.1',
  maxBodyBytes: 1_048_576,
  maxConcurrent: 4,
  maxSessions: 64,
  model: 'sonnet',
  port: 8901,
  sessionTtlMs: 10_800_000,
  timeoutMs: 300_000,
};

const OPTIONS = {
  'claude-path': 'claudePath',
  host: 'host',
  'max-body-bytes': 'maxBodyBytes',
  'max-concurrent': 'maxConcurrent',
  'max-sessions': 'maxSessions',
  model: 'model',
  port: 'port',
  'session-ttl-ms': 'sessionTtlMs',
  'timeout-ms': 'timeoutMs',
};

const ENVIRONMENT = {
  CLAUDE_PROXY_API_KEY: 'apiKey',
  CLAUDE_PROXY_CLAUDE_PATH: 'claudePath',
  CLAUDE_PROXY_HOST: 'host',
  CLAUDE_PROXY_MAX_BODY_BYTES: 'maxBodyBytes',
  CLAUDE_PROXY_MAX_CONCURRENT: 'maxConcurrent',
  CLAUDE_PROXY_MAX_SESSIONS: 'maxSessions',
  CLAUDE_PROXY_MODEL: 'model',
  CLAUDE_PROXY_PORT: 'port',
  CLAUDE_PROXY_SESSION_TTL_MS: 'sessionTtlMs',
  CLAUDE_PROXY_TIMEOUT_MS: 'timeoutMs',
};

const NUMERIC_FIELDS = new Set([
  'maxBodyBytes', 'maxConcurrent', 'maxSessions', 'port', 'sessionTtlMs', 'timeoutMs',
]);

function applyEnvironment(config, environment) {
  for (const [name, field] of Object.entries(ENVIRONMENT)) {
    if (environment[name] !== undefined) config[field] = environment[name];
  }
}

function applyArguments(config, argv) {
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]?.replace(/^--/, '');
    const field = OPTIONS[name];
    if (!field || argv[index + 1] === undefined) throw new Error(`Unknown or incomplete option: ${argv[index]}`);
    config[field] = argv[index + 1];
  }
}

function parseInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${fieldName(field)} must be an integer greater than zero`);
  if (field === 'port' && number > 65_535) throw new Error('port must be at most 65535');
  return number;
}

function fieldName(field) {
  return Object.entries(OPTIONS).find(([, value]) => value === field)?.[0] ?? field;
}

function validateStrings(config) {
  for (const field of ['claudePath', 'host', 'model']) {
    if (typeof config[field] !== 'string' || !config[field].trim()) throw new Error(`${fieldName(field)} must not be empty`);
    config[field] = config[field].trim();
  }
}

export function readConfig(argv = process.argv.slice(2), environment = process.env) {
  const config = { ...DEFAULTS };
  applyEnvironment(config, environment);
  applyArguments(config, argv);
  for (const field of NUMERIC_FIELDS) config[field] = parseInteger(config[field], field);
  validateStrings(config);
  return config;
}
