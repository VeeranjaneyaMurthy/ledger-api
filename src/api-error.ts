import { ParseUUIDPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
  }
}

export const uuidPipe = new ParseUUIDPipe({
  exceptionFactory: () => new ApiError(400, 'VALIDATION_ERROR', 'Invalid request', ['id must be a UUID']),
});

export function accountNotFound(details: unknown = null) {
  return new ApiError(404, 'ACCOUNT_NOT_FOUND', 'Account not found', details);
}

export function insufficientBalance(balance: bigint, amount: bigint) {
  return new ApiError(422, 'INSUFFICIENT_BALANCE', 'Insufficient balance', {
    balance: Number(balance),
    amount: Number(amount),
  });
}

export function isUniqueViolation(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}
