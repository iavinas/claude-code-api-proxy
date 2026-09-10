import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

import { asOpenAIError, OpenAIError, openAIErrorBody } from './errors.mjs';
import { toSse } from './protocol.mjs';

function sendJson(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-length': Buffer.byteLength(text),
    'content-type': 'application/json',
  });
  response.end(text);
}

function sendSse(response, completion, includeUsage) {
  response.writeHead(200, {
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'content-type': 'text/event-stream; charset=utf-8',
  });
  response.end(toSse(completion, includeUsage));
}

function bearerToken(request) {
  const value = request.headers.authorization ?? '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

function equalSecret(actual, expected) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function authorize(request, apiKey) {
  if (!apiKey || equalSecret(bearerToken(request), apiKey)) return;
  throw new OpenAIError('Invalid authentication credentials.', {
    status: 401,
    type: 'authentication_error',
    code: 'invalid_api_key',
  });
}

function readBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let body = '';
    let tooLarge = false;
    request.on('data', (chunk) => {
      if (tooLarge) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        tooLarge = true;
        reject(new OpenAIError('Request body is too large.', { status: 413, code: 'request_too_large' }));
        return;
      }
      body += chunk;
    });
    request.on('end', () => { if (!tooLarge) resolve(body); });
    request.on('error', reject);
  });
}

async function readJson(request, maxBytes) {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    throw new OpenAIError('Content-Type must be application/json.', { status: 415, code: 'unsupported_media_type' });
  }
  const text = await readBody(request, maxBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new OpenAIError('Request body must be valid JSON.', { code: 'invalid_json' });
  }
}

function sessionKey(request) {
  const value = request.headers['x-claude-session-id'];
  if (value === undefined) return '';
  if (typeof value !== 'string' || !/^[A-Za-z0-9._~-]{1,128}$/.test(value)) {
    throw new OpenAIError('X-Claude-Session-Id contains invalid characters.', { param: 'X-Claude-Session-Id' });
  }
  return value;
}

function modelList(config) {
  return {
    object: 'list',
    data: [{ id: config.model, object: 'model', created: 0, owned_by: 'claude-code' }],
  };
}

function health(config, claudeVersion) {
  return {
    status: 'ok',
    model: config.model,
    claude_cli_version: claudeVersion,
    authentication: 'unchecked',
  };
}

function requestSignal(request, response) {
  const controller = new AbortController();
  request.on('aborted', () => controller.abort());
  response.on('close', () => { if (!response.writableEnded) controller.abort(); });
  return controller.signal;
}

async function complete(request, response, context) {
  const body = await readJson(request, context.config.maxBodyBytes);
  const completion = await context.service.complete(body, {
    sessionKey: sessionKey(request),
    signal: requestSignal(request, response),
  });
  if (body.stream === true) sendSse(response, completion, body.stream_options?.include_usage === true);
  else sendJson(response, 200, completion);
}

async function route(request, response, context) {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (request.method === 'GET' && path === '/health') return sendJson(response, 200, health(context.config, context.claudeVersion));
  if (path.startsWith('/v1/')) authorize(request, context.config.apiKey);
  if (request.method === 'GET' && path === '/v1/models') return sendJson(response, 200, modelList(context.config));
  if (request.method === 'POST' && path === '/v1/chat/completions') return complete(request, response, context);
  throw new OpenAIError('Not found.', { status: 404, type: 'invalid_request_error', code: 'not_found' });
}

export function createProxyServer(context) {
  return createServer(async (request, response) => {
    try {
      await route(request, response, context);
    } catch (caught) {
      const error = asOpenAIError(caught);
      context.onError?.(caught);
      if (!response.headersSent) sendJson(response, error.status, openAIErrorBody(error));
      else response.destroy();
    }
  });
}
