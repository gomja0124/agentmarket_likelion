export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = message => new ApiError(404, 'NOT_FOUND', message);
export const forbidden = message => new ApiError(403, 'FORBIDDEN', message);
export const invalidState = message => new ApiError(409, 'INVALID_STATE', message);
export const validationError = (message, details) => new ApiError(422, 'VALIDATION_ERROR', message, details);
