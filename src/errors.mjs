export class OpenAIError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'OpenAIError';
    this.status = options.status ?? 400;
    this.type = options.type ?? 'invalid_request_error';
    this.code = options.code ?? null;
    this.param = options.param ?? null;
  }
}

export function openAIErrorBody(error) {
  return {
    error: {
      message: error.message,
      type: error.type,
      param: error.param,
      code: error.code,
    },
  };
}

export function asOpenAIError(error) {
  if (error instanceof OpenAIError) return error;
  return new OpenAIError('The server encountered an internal error.', {
    status: 500,
    type: 'server_error',
    code: 'internal_error',
  });
}
