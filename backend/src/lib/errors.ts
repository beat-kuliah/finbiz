export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export function errorResponse(code: string, message: string): ErrorResponse {
  return { error: { code, message } };
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}
