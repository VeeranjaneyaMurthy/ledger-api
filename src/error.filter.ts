import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { ApiError } from './api-error';

export function pgError(e: unknown): { code: string; message: string } | null {
  if (e instanceof Prisma.PrismaClientKnownRequestError && typeof e.meta?.code === 'string') {
    return { code: e.meta.code, message: String(e.meta.message ?? e.message) };
  }
  if (e instanceof Prisma.PrismaClientUnknownRequestError) {
    const match = e.message.match(/PostgresError \{ code: "(\w{5})"/);
    if (match) return { code: match[1], message: e.message };
  }
  return null;
}

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;

  if (e instanceof HttpException) {
    const status = e.getStatus();
    if (status === 404) return new ApiError(404, 'NOT_FOUND', e.message);
    if (status === 400) return new ApiError(400, 'VALIDATION_ERROR', 'Invalid request', [e.message]);
    return new ApiError(500, 'INTERNAL_ERROR', 'Internal server error');
  }

  const pg = pgError(e);
  if (pg?.code === '23514') {
    if (pg.message.includes('accounts_balance_check')) {
      return new ApiError(422, 'INSUFFICIENT_BALANCE', 'Insufficient balance');
    }
    if (pg.message.includes('transactions_amount_check')) {
      return new ApiError(400, 'VALIDATION_ERROR', 'amount must be greater than 0');
    }
  }

  return new ApiError(500, 'INTERNAL_ERROR', 'Internal server error');
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ErrorFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const error = toApiError(exception);
    if (error.status === 500) {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(err.message, err.stack);
    }
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(error.status)
      .json({ error: { code: error.code, message: error.message, details: error.details } });
  }
}
