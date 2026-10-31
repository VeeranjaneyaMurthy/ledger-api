import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma.service';
import { createApp, resetDb } from './helpers';

describe('validation', () => {
  let app: INestApplication;
  let api: ReturnType<typeof request>;
  let prisma: PrismaService;
  let a: string;
  let b: string;

  beforeAll(async () => {
    app = await createApp();
    api = request(app.getHttpServer());
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDb(app);
    a = (await api.post('/accounts').send({ name: 'A' })).body.id;
    b = (await api.post('/accounts').send({ name: 'B' })).body.id;
    await api.post(`/accounts/${a}/transactions`).send({ type: 'credit', amount: 100, reference_id: 'seed' });
  });

  afterAll(() => app.close());

  function expectValidationError(res: request.Response) {
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: expect.any(Array) },
    });
  }

  async function expectNothingChanged() {
    expect(await prisma.transaction.count()).toBe(1);
    expect((await api.get(`/accounts/${a}/balance`)).body.balance).toBe(100);
    expect((await api.get(`/accounts/${b}/balance`)).body.balance).toBe(0);
  }

  describe('error shape', () => {
    it('returns NOT_FOUND for an unknown route', async () => {
      const res = await api.get('/nope');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String), details: null } });
    });

    it('returns VALIDATION_ERROR for malformed JSON', async () => {
      const res = await api.post('/accounts').set('Content-Type', 'application/json').send('{"name": ');
      expect(res.status).toBe(400);
      expect(res.body.error).toEqual({
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        details: ['Unexpected end of JSON input'],
      });
    });

    it('serves Swagger at /docs', async () => {
      const res = await api.get('/docs');
      expect(res.status).toBe(200);
    });
  });

  describe('path ids', () => {
    it.each([
      ['GET', '/accounts/not-a-uuid/balance'],
      ['GET', '/accounts/not-a-uuid/transactions'],
      ['POST', '/accounts/not-a-uuid/transactions'],
    ])('%s %s returns VALIDATION_ERROR', async (method, path) => {
      const res =
        method === 'GET'
          ? await api.get(path)
          : await api.post(path).send({ type: 'credit', amount: 1, reference_id: 'X' });
      expectValidationError(res);
      expect(res.body.error.details).toEqual(['id must be a UUID']);
    });
  });

  describe('pagination query', () => {
    it('accepts numeric strings for page and limit', async () => {
      const res = await api.get(`/accounts/${a}/transactions?page=2&limit=10`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ page: 2, page_size: 10 });
    });

    it.each(['page=0', 'page=-1', 'page=abc', 'page=1.5', 'limit=0', 'limit=101', 'limit=abc', 'type=refund', 'foo=1'])(
      '?%s returns VALIDATION_ERROR',
      async (query) => {
        expectValidationError(await api.get(`/accounts/${a}/transactions?${query}`));
      },
    );
  });

  describe('create account body', () => {
    it('rejects a client-set balance', async () => {
      const res = await api.post('/accounts').send({ name: 'C', balance: 500 });
      expectValidationError(res);
      expect(res.body.error.details).toEqual(['property balance should not exist']);
      expect(await prisma.account.count()).toBe(2);
    });
  });

  describe('transaction body', () => {
    const valid = { type: 'debit', amount: 10, reference_id: 'R1' };

    it.each([
      ['amount 100.50', { amount: 100.5 }],
      ['amount 0', { amount: 0 }],
      ['amount -5', { amount: -5 }],
      ['amount "100"', { amount: '100' }],
      ['amount above MAX_SAFE_INTEGER', { amount: Number.MAX_SAFE_INTEGER + 2 }],
      ['missing amount', { amount: undefined }],
      ['type refund', { type: 'refund' }],
      ['missing type', { type: undefined }],
      ['missing reference_id', { reference_id: undefined }],
      ['whitespace reference_id', { reference_id: '   ' }],
      ['numeric reference_id', { reference_id: 123 }],
      ['non-string description', { description: 5 }],
      ['unknown field', { account_id: 'x' }],
    ])('rejects %s and changes nothing', async (_, override) => {
      const res = await api.post(`/accounts/${a}/transactions`).send({ ...valid, ...override });
      expectValidationError(res);
      await expectNothingChanged();
    });
  });

  describe('transfer body', () => {
    const valid = () => ({ from_account_id: a, to_account_id: b, amount: 10, reference_id: 'T1' });

    it.each([
      ['bad from_account_id', { from_account_id: 'not-a-uuid' }],
      ['bad to_account_id', { to_account_id: 'not-a-uuid' }],
      ['missing to_account_id', { to_account_id: undefined }],
      ['amount 100.50', { amount: 100.5 }],
      ['amount 0', { amount: 0 }],
      ['amount "100"', { amount: '100' }],
      ['whitespace reference_id', { reference_id: '  ' }],
      ['unknown field', { type: 'credit' }],
    ])('rejects %s and changes nothing', async (_, override) => {
      const res = await api.post('/transfers').send({ ...valid(), ...override });
      expectValidationError(res);
      await expectNothingChanged();
    });
  });
});
