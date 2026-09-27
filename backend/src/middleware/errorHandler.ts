import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
) {
  const requestId = (req as Request & { requestId?: string }).requestId;

  if (err instanceof AppError) {
    logger.warn({ request_id: requestId, code: err.code, status: err.statusCode }, err.message);

    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
      request_id: requestId,
    });
  }

  logger.error({ request_id: requestId, error: err.message, stack: err.stack }, 'Unexpected error');

  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
    request_id: requestId,
  });
}
