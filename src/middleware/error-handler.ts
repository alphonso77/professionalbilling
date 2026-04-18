import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';

export class AppError extends Error {
  public code?: string;
  constructor(
    public statusCode: number,
    public message: string,
    codeOrOperational?: string | boolean,
    public isOperational = true
  ) {
    super(message);
    if (typeof codeOrOperational === 'string') {
      this.code = codeOrOperational;
    } else if (typeof codeOrOperational === 'boolean') {
      this.isOperational = codeOrOperational;
    }
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation Error',
      details: err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  if (err instanceof AppError) {
    const body = err.code
      ? { error: { message: err.message, code: err.code } }
      : { error: err.message };
    res.status(err.statusCode).json(body);
    return;
  }

  logger.error('Unhandled error', { err: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal Server Error' });
}
