import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiError } from './api-error';
import { pgError, toApiError } from './error.filter';

const version = '6.19.3';

function rawError(code: string, message: string) {
  return new Prisma.PrismaClientKnownRequestError(`Raw query failed. Code: \`${code}\`.`, {
    code: 'P2010',
    clientVersion: version,
    meta: { code, message },
  });
}

function ormError(code: string, message: string) {
  return new Prisma.PrismaClientUnknownRequestError(
    `Error occurred during query execution:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "${code}", message: "${message}", severity: "ERROR", detail: None, column: None, hint: None }), transient: false })`,
    { clientVersion: version },
  );
}

describe('pgError', () => {
  it('reads SQLSTATE from a raw-query error', () => {
    const e = rawError('23514', 'ERROR: new row violates check constraint "accounts_balance_check"');
    expect(pgError(e)).toEqual({ code: '23514', message: expect.stringContaining('accounts_balance_check') });
  });

  it('reads SQLSTATE from an ORM write error', () => {
    const e = ormError('P0001', 'transactions are immutable');
    expect(pgError(e)).toEqual({ code: 'P0001', message: expect.stringContaining('transactions are immutable') });
  });

  it('returns null for other errors', () => {
    expect(pgError(new Error('boom'))).toBeNull();
  });
});

describe('toApiError', () => {
  it('keeps an ApiError as is', () => {
    const e = new ApiError(409, 'DUPLICATE_REFERENCE', 'exists', { id: 1 });
    expect(toApiError(e)).toBe(e);
  });

  it('maps the balance CHECK to 422 with null details, from both wrappers', () => {
    for (const e of [
      rawError('23514', 'violates check constraint "accounts_balance_check"'),
      ormError('23514', 'violates check constraint \\"accounts_balance_check\\"'),
    ]) {
      expect(toApiError(e)).toMatchObject({ status: 422, code: 'INSUFFICIENT_BALANCE', details: null });
    }
  });

  it('maps the amount CHECK to 400', () => {
    const e = ormError('23514', 'violates check constraint \\"transactions_amount_check\\"');
    expect(toApiError(e)).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });

  it('maps other CHECKs and trigger errors to 500', () => {
    expect(toApiError(ormError('23514', 'accounts_name_check'))).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    expect(toApiError(rawError('P0001', 'transactions are immutable'))).toMatchObject({ status: 500 });
  });

  it('maps HttpExceptions', () => {
    expect(toApiError(new NotFoundException())).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(toApiError(new BadRequestException('Unexpected end of JSON input'))).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      details: ['Unexpected end of JSON input'],
    });
  });

  it('maps unknown errors to 500', () => {
    expect(toApiError(new Error('boom'))).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
  });
});
