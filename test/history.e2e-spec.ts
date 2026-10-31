import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma.service';
import { createApp, resetDb } from './helpers';

describe('GET /accounts/:id/transactions', () => {
  let app: INestApplication;
  let api: ReturnType<typeof request>;

  beforeAll(async () => {
    app = await createApp();
    api = request(app.getHttpServer());
  });

  beforeEach(() => resetDb(app));

  afterAll(() => app.close());

  async function createAccount() {
    const res = await api.post('/accounts').send({ name: 'Asha' });
    return res.body.id as string;
  }

  async function post(accountId: string, type: string, amount: number, reference_id: string) {
    const res = await api.post(`/accounts/${accountId}/transactions`).send({ type, amount, reference_id });
    expect(res.status).toBe(201);
  }

  function list(accountId: string, query = '') {
    return api.get(`/accounts/${accountId}/transactions${query}`);
  }

  async function seed(accountId: string, credits: number, debits: number) {
    for (let i = 0; i < credits; i++) await post(accountId, 'credit', 100, `C${i}`);
    for (let i = 0; i < debits; i++) await post(accountId, 'debit', 10, `D${i}`);
  }

  it('returns transactions latest first with pagination fields', async () => {
    const id = await createAccount();
    await seed(id, 3, 0);

    const res = await list(id);

    expect(res.status).toBe(200);
    expect(res.body.data.map((t: { reference_id: string }) => t.reference_id)).toEqual(['C2', 'C1', 'C0']);
    expect(res.body).toMatchObject({ page: 1, page_size: 10, total_records: 3, total_pages: 1 });
    expect(Object.keys(res.body.data[0]).sort()).toEqual(
      ['account_id', 'amount', 'created_at', 'description', 'id', 'reference_id', 'type'],
    );
  });

  it('breaks created_at ties by insertion order', async () => {
    const id = await createAccount();
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    await app.get(PrismaService).transaction.createMany({
      data: ['T0', 'T1', 'T2', 'T3', 'T4'].map((referenceId) => ({
        accountId: id,
        type: 'credit' as const,
        amount: 1n,
        referenceId,
        createdAt,
      })),
    });

    const res = await list(id);

    expect(res.body.data.map((t: { reference_id: string }) => t.reference_id)).toEqual(['T4', 'T3', 'T2', 'T1', 'T0']);
  });

  it('returns only one account\'s transactions', async () => {
    const a = await createAccount();
    const b = await createAccount();
    await seed(a, 2, 0);
    await seed(b, 1, 0);

    const res = await list(a);

    expect(res.body.total_records).toBe(2);
    expect(res.body.data.every((t: { account_id: string }) => t.account_id === a)).toBe(true);
  });

  describe('type filter', () => {
    it.each([
      ['credit', 7],
      ['debit', 3],
    ])('type=%s returns only that type and counts the filtered set', async (type, count) => {
      const id = await createAccount();
      await seed(id, 7, 3);

      const res = await list(id, `?type=${type}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(count);
      expect(res.body.data.every((t: { type: string }) => t.type === type)).toBe(true);
      expect(res.body.total_records).toBe(count);
    });

    it('returns both types when no type is given', async () => {
      const id = await createAccount();
      await seed(id, 7, 3);

      const res = await list(id);

      expect(res.body.total_records).toBe(10);
      expect(new Set(res.body.data.map((t: { type: string }) => t.type))).toEqual(new Set(['credit', 'debit']));
    });

    it('computes total_pages from the filtered set', async () => {
      const id = await createAccount();
      await seed(id, 7, 3);

      const res = await list(id, '?type=debit&limit=2');

      expect(res.body).toMatchObject({ page: 1, page_size: 2, total_records: 3, total_pages: 2 });
      expect(res.body.data).toHaveLength(2);
    });

    it('rejects an unknown type', async () => {
      const id = await createAccount();
      const res = await list(id, '?type=foo');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('pagination', () => {
    it('pages through results without gaps or overlap', async () => {
      const id = await createAccount();
      await seed(id, 25, 0);

      const pages = await Promise.all([1, 2, 3].map((p) => list(id, `?page=${p}&limit=10`)));

      expect(pages.map((p) => p.body.data.length)).toEqual([10, 10, 5]);
      expect(pages[2].body).toMatchObject({ page: 3, page_size: 10, total_records: 25, total_pages: 3 });
      const refs = pages.flatMap((p) => p.body.data.map((t: { reference_id: string }) => t.reference_id));
      expect(refs).toEqual(Array.from({ length: 25 }, (_, i) => `C${24 - i}`));
    });

    it('returns empty data for a page past the end', async () => {
      const id = await createAccount();
      await seed(id, 3, 0);

      const res = await list(id, '?page=5');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [], page: 5, page_size: 10, total_records: 3, total_pages: 1 });
    });

    it('returns zero pages for an account with no transactions', async () => {
      const id = await createAccount();
      const res = await list(id);
      expect(res.body).toEqual({ data: [], page: 1, page_size: 10, total_records: 0, total_pages: 0 });
    });
  });

  it('returns ACCOUNT_NOT_FOUND for an unknown account', async () => {
    const res = await list('7f1c2e4a-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });
});
