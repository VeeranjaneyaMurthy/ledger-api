import { INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma.service';
import { createApp, resetDb } from './helpers';

const MISSING_ID = '7f1c2e4a-0000-4000-8000-000000000000';

describe('POST /transfers', () => {
  let app: INestApplication;
  let api: ReturnType<typeof request>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createApp();
    api = request(app.getHttpServer());
    prisma = app.get(PrismaService);
  });

  beforeEach(() => resetDb(app));

  afterAll(() => app.close());

  async function createAccount(name: string, opening = 0) {
    const res = await api.post('/accounts').send({ name });
    if (opening > 0) {
      await api.post(`/accounts/${res.body.id}/transactions`).send({ type: 'credit', amount: opening, reference_id: 'opening' });
    }
    return res.body.id as string;
  }

  function transfer(from: string, to: string, amount: number, reference_id: string) {
    return api.post('/transfers').send({ from_account_id: from, to_account_id: to, amount, reference_id });
  }

  async function balance(id: string) {
    const res = await api.get(`/accounts/${id}/balance`);
    return res.body.balance;
  }

  it('moves money between accounts (spec example)', async () => {
    const a = await createAccount('A', 100);
    const b = await createAccount('B', 50);

    const res = await transfer(a, b, 30, 'T1');

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      reference_id: 'T1',
      amount: 30,
      debit: expect.objectContaining({ account_id: a, type: 'debit', amount: 30, reference_id: 'T1' }),
      credit: expect.objectContaining({ account_id: b, type: 'credit', amount: 30, reference_id: 'T1' }),
    });
    expect(await balance(a)).toBe(70);
    expect(await balance(b)).toBe(80);
  });

  it('shows each leg in its account history', async () => {
    const a = await createAccount('A', 100);
    const b = await createAccount('B');
    await transfer(a, b, 30, 'T1');

    const historyA = await api.get(`/accounts/${a}/transactions?type=debit`);
    const historyB = await api.get(`/accounts/${b}/transactions?type=credit`);

    expect(historyA.body.data).toEqual([expect.objectContaining({ amount: 30, reference_id: 'T1' })]);
    expect(historyB.body.data).toEqual([expect.objectContaining({ amount: 30, reference_id: 'T1' })]);
  });

  it('rejects insufficient balance and changes nothing', async () => {
    const a = await createAccount('A', 100);
    const b = await createAccount('B', 50);
    const before = await prisma.transaction.count();

    const res = await transfer(a, b, 150, 'T1');

    expect(res.status).toBe(422);
    expect(res.body.error).toEqual({
      code: 'INSUFFICIENT_BALANCE',
      message: 'Insufficient balance',
      details: { balance: 100, amount: 150 },
    });
    expect(await balance(a)).toBe(100);
    expect(await balance(b)).toBe(50);
    expect(await prisma.transaction.count()).toBe(before);
  });

  it('returns 404 when the source account is missing', async () => {
    const b = await createAccount('B', 50);

    const res = await transfer(MISSING_ID, b, 10, 'T1');

    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({
      code: 'ACCOUNT_NOT_FOUND',
      message: 'Account not found',
      details: { account_id: MISSING_ID },
    });
    expect(await balance(b)).toBe(50);
  });

  it('returns 404 when the destination account is missing', async () => {
    const a = await createAccount('A', 100);

    const res = await transfer(a, MISSING_ID, 10, 'T1');

    expect(res.status).toBe(404);
    expect(res.body.error.details).toEqual({ account_id: MISSING_ID });
    expect(await balance(a)).toBe(100);
  });

  it('rejects a transfer to the same account', async () => {
    const a = await createAccount('A', 100);

    const res = await transfer(a, a, 10, 'T1');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(['from_account_id and to_account_id must be different']);
    expect(await balance(a)).toBe(100);
  });

  describe('duplicate reference_id', () => {
    it('returns 409 when the source already has the reference', async () => {
      const a = await createAccount('A', 100);
      const b = await createAccount('B');
      await transfer(a, b, 30, 'T1');

      const res = await transfer(a, b, 30, 'T1');

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DUPLICATE_REFERENCE');
      expect(res.body.error.details.transactions).toHaveLength(2);
      expect(await balance(a)).toBe(70);
      expect(await balance(b)).toBe(30);
    });

    it('returns 409 when only the destination has the reference', async () => {
      const a = await createAccount('A', 100);
      const b = await createAccount('B');
      await api.post(`/accounts/${b}/transactions`).send({ type: 'credit', amount: 5, reference_id: 'T1' });

      const res = await transfer(a, b, 30, 'T1');

      expect(res.status).toBe(409);
      expect(res.body.error.details.transactions).toEqual([
        expect.objectContaining({ account_id: b, amount: 5, reference_id: 'T1' }),
      ]);
      expect(await balance(a)).toBe(100);
      expect(await balance(b)).toBe(5);
    });
  });

  describe('concurrency', () => {
    it('creates one transfer for two parallel requests with one reference', async () => {
      const a = await createAccount('A', 100);
      const b = await createAccount('B', 50);

      const results = await Promise.all([transfer(a, b, 30, 'T1'), transfer(a, b, 30, 'T1')]);
      const statuses = results.map((r) => r.status).sort();

      expect(statuses).toEqual([201, 409]);
      expect(await balance(a)).toBe(70);
      expect(await balance(b)).toBe(80);
    });

    it('runs opposite-direction transfers without deadlock', async () => {
      const a = await createAccount('A', 100);
      const b = await createAccount('B', 100);

      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => [transfer(a, b, 1, `AB${i}`), transfer(b, a, 1, `BA${i}`)]).flat(),
      );

      expect(results.map((r) => r.status).every((s) => s === 201)).toBe(true);
      expect(await balance(a)).toBe(100);
      expect(await balance(b)).toBe(100);
    });
  });

  describe('rollback', () => {
    afterEach(async () => {
      jest.restoreAllMocks();
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_fail_credit ON transactions');
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_fail_credit_fn');
    });

    it('undoes the debit when the credit leg fails', async () => {
      const a = await createAccount('A', 100);
      const b = await createAccount('B', 50);
      const before = await prisma.transaction.count();
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION test_fail_credit_fn() RETURNS trigger AS $$
        BEGIN
          IF NEW.type = 'credit' AND NEW.account_id = '${b}'::uuid THEN
            RAISE EXCEPTION 'forced credit failure';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql`);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER test_fail_credit BEFORE INSERT ON transactions
        FOR EACH ROW EXECUTE FUNCTION test_fail_credit_fn()`);
      const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      const res = await transfer(a, b, 30, 'T1');

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(logError).toHaveBeenCalledWith(expect.stringContaining('forced credit failure'), expect.anything());
      expect(await balance(a)).toBe(100);
      expect(await balance(b)).toBe(50);
      expect(await prisma.transaction.count()).toBe(before);
    });
  });
});
