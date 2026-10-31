import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma.service';
import { createApp, resetDb } from './helpers';

describe('POST /accounts/:id/transactions', () => {
  let app: INestApplication;
  let api: ReturnType<typeof request>;

  beforeAll(async () => {
    app = await createApp();
    api = request(app.getHttpServer());
  });

  beforeEach(() => resetDb(app));

  afterAll(() => app.close());

  async function createAccount(name = 'Asha') {
    const res = await api.post('/accounts').send({ name });
    return res.body.id as string;
  }

  function post(accountId: string, type: string, amount: number, reference_id: string, description?: string) {
    return api.post(`/accounts/${accountId}/transactions`).send({ type, amount, reference_id, description });
  }

  async function balance(accountId: string) {
    const res = await api.get(`/accounts/${accountId}/balance`);
    return res.body.balance;
  }

  function transactionCount() {
    return app.get(PrismaService).transaction.count();
  }

  it('credit increases the balance and returns the transaction', async () => {
    const id = await createAccount();
    await post(id, 'credit', 100, 'R1');

    const res = await post(id, 'credit', 50, 'R2', 'salary');

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      account_id: id,
      type: 'credit',
      amount: 50,
      description: 'salary',
      reference_id: 'R2',
      created_at: expect.any(String),
    });
    expect(await balance(id)).toBe(150);
  });

  it('debit decreases the balance', async () => {
    const id = await createAccount();
    await post(id, 'credit', 100, 'R1');

    const res = await post(id, 'debit', 30, 'R2');

    expect(res.status).toBe(201);
    expect(await balance(id)).toBe(70);
  });

  it('matches the spec balance sequence', async () => {
    const id = await createAccount();
    await post(id, 'credit', 100, 'R1');
    await post(id, 'credit', 50, 'R2');
    await post(id, 'debit', 30, 'R3');
    await post(id, 'debit', 20, 'R4');

    expect(await balance(id)).toBe(100);
  });

  it('stores description as null when omitted', async () => {
    const id = await createAccount();
    const res = await post(id, 'credit', 100, 'R1');
    expect(res.body.description).toBeNull();
  });

  it('rejects a debit over the balance and changes nothing', async () => {
    const id = await createAccount();
    await post(id, 'credit', 100, 'R1');

    const res = await post(id, 'debit', 150, 'R2');

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      error: {
        code: 'INSUFFICIENT_BALANCE',
        message: 'Insufficient balance',
        details: { balance: 100, amount: 150 },
      },
    });
    expect(await balance(id)).toBe(100);
    expect(await transactionCount()).toBe(1);
  });

  it('allows a debit of the exact balance', async () => {
    const id = await createAccount();
    await post(id, 'credit', 100, 'R1');

    const res = await post(id, 'debit', 100, 'R2');

    expect(res.status).toBe(201);
    expect(await balance(id)).toBe(0);
  });

  describe('duplicate reference_id', () => {
    it('returns 409 with the original and changes nothing', async () => {
      const id = await createAccount();
      const original = await post(id, 'credit', 100, 'R1');

      const res = await post(id, 'credit', 100, 'R1');

      expect(res.status).toBe(409);
      expect(res.body.error).toEqual({
        code: 'DUPLICATE_REFERENCE',
        message: 'A transaction with this reference_id already exists',
        details: { transaction: original.body },
      });
      expect(await balance(id)).toBe(100);
      expect(await transactionCount()).toBe(1);
    });

    it('returns 409 even when amount and type differ', async () => {
      const id = await createAccount();
      const original = await post(id, 'credit', 100, 'R1');

      const res = await post(id, 'debit', 5, 'R1');

      expect(res.status).toBe(409);
      expect(res.body.error.details.transaction).toEqual(original.body);
      expect(await balance(id)).toBe(100);
    });

    it('checks duplicates before balance, so a retried debit returns 409', async () => {
      const id = await createAccount();
      await post(id, 'credit', 100, 'R1');
      await post(id, 'debit', 100, 'R2');

      const res = await post(id, 'debit', 100, 'R2');

      expect(res.status).toBe(409);
      expect(await balance(id)).toBe(0);
    });

    it('treats a padded reference_id as the same reference', async () => {
      const id = await createAccount();
      await post(id, 'credit', 100, 'REF1');

      const res = await post(id, 'credit', 100, ' REF1 ');

      expect(res.status).toBe(409);
      expect(res.body.error.details.transaction.reference_id).toBe('REF1');
    });

    it('allows the same reference_id on different accounts', async () => {
      const a = await createAccount('A');
      const b = await createAccount('B');

      expect((await post(a, 'credit', 100, 'R1')).status).toBe(201);
      expect((await post(b, 'credit', 100, 'R1')).status).toBe(201);
      expect(await balance(a)).toBe(100);
      expect(await balance(b)).toBe(100);
    });
  });

  it('returns ACCOUNT_NOT_FOUND for an unknown account', async () => {
    const res = await post('7f1c2e4a-0000-4000-8000-000000000000', 'credit', 100, 'R1');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  describe('concurrency', () => {
    it('never overdraws under 20 parallel debits', async () => {
      const id = await createAccount();
      await post(id, 'credit', 100, 'seed');

      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => post(id, 'debit', 10, `D${i}`)),
      );
      const statuses = results.map((r) => r.status);

      expect(statuses).not.toContain(500);
      expect(statuses.filter((s) => s === 201)).toHaveLength(10);
      expect(statuses.filter((s) => s === 422)).toHaveLength(10);
      expect(await balance(id)).toBe(0);
    });

    it('creates exactly one transaction for 10 parallel posts with one reference', async () => {
      const id = await createAccount();

      const results = await Promise.all(
        Array.from({ length: 10 }, () => post(id, 'credit', 100, 'SAME')),
      );
      const statuses = results.map((r) => r.status);

      expect(statuses).not.toContain(500);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(9);
      expect(await balance(id)).toBe(100);
      expect(await transactionCount()).toBe(1);
    });
  });
});
