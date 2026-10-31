import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma.service';
import { createApp, resetDb } from './helpers';

describe('transaction immutability', () => {
  let app: INestApplication;
  let api: ReturnType<typeof request>;
  let prisma: PrismaService;
  let accountId: string;
  let tx: { id: string };

  beforeAll(async () => {
    app = await createApp();
    api = request(app.getHttpServer());
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDb(app);
    const account = await api.post('/accounts').send({ name: 'Asha' });
    accountId = account.body.id;
    const created = await api
      .post(`/accounts/${accountId}/transactions`)
      .send({ type: 'credit', amount: 100, reference_id: 'R1', description: 'original' });
    tx = created.body;
  });

  afterAll(() => app.close());

  async function history() {
    const res = await api.get(`/accounts/${accountId}/transactions`);
    return res.body.data;
  }

  describe('through the API', () => {
    it.each(['put', 'patch', 'delete'] as const)('%s on a transaction returns NOT_FOUND', async (method) => {
      const before = await history();

      const res = await api[method](`/accounts/${accountId}/transactions/${tx.id}`).send({ amount: 1 });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(await history()).toEqual(before);
    });

    it.each(['put', 'patch', 'delete'] as const)('%s on the collection returns NOT_FOUND', async (method) => {
      const before = await history();

      const res = await api[method](`/accounts/${accountId}/transactions`).send({ amount: 1 });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(await history()).toEqual(before);
    });
  });

  describe('in the database', () => {
    it('blocks a raw UPDATE', async () => {
      await expect(
        prisma.$executeRaw`UPDATE transactions SET amount = 1 WHERE id = ${tx.id}::uuid`,
      ).rejects.toThrow('transactions are immutable');
      expect(await history()).toEqual([tx]);
    });

    it('blocks a raw DELETE', async () => {
      await expect(prisma.$executeRaw`DELETE FROM transactions`).rejects.toThrow('transactions are immutable');
      expect(await history()).toEqual([tx]);
    });

    it('blocks an ORM update', async () => {
      await expect(
        prisma.transaction.update({ where: { id: tx.id }, data: { description: 'changed' } }),
      ).rejects.toThrow('transactions are immutable');
    });

    it('blocks a negative balance', async () => {
      await expect(
        prisma.$executeRaw`UPDATE accounts SET balance = -1 WHERE id = ${accountId}::uuid`,
      ).rejects.toThrow('accounts_balance_check');
      expect((await api.get(`/accounts/${accountId}/balance`)).body.balance).toBe(100);
    });
  });
});
