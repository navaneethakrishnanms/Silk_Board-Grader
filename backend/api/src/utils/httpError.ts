export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Authentication required') => new HttpError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'You do not have permission for this action') => new HttpError(403, 'FORBIDDEN', msg);
export const notFound = (what = 'Resource') => new HttpError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (msg: string, details?: unknown) => new HttpError(409, 'CONFLICT', msg, details);
export const unprocessable = (msg: string, details?: unknown) => new HttpError(422, 'UNPROCESSABLE', msg, details);
export const badGateway = (msg: string, details?: unknown) => new HttpError(502, 'ENGINE_ERROR', msg, details);
