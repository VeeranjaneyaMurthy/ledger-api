import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma.service';
import { createApp, resetDb } from './helpers';

describe('accounts', () => {
  let app: INestApplication;
  let api: ReturnType<typeof request>;

  beforeAll(async () => {
    app = await createApp();
    api = request(app.getHttpServer());
  });

  beforeEach(() => resetDb(app));

  afterAll(() => app.close());

  describe('POST /accounts', () => {
    it('creates an account with balance 0', async () => {
      const res = await api.post('/accounts').send({ name: 'Asha' });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        name: 'Asha',
        balance: 0,
        created_at: expect.any(String),
      });
      expect(Number.isNaN(Date.parse(res.body.created_at))).toBe(false);
    });

    it('stores the name trimmed', async () => {
      const res = await api.post('/accounts').send({ name: '  Asha  ' });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Asha');
    });

    it('gives each account a unique id', async () => {
      const a = await api.post('/accounts').send({ name: 'A' });
      const b = await api.post('/accounts').send({ name: 'B' });
      expect(a.body.id).not.toBe(b.body.id);
    });

    it.each([
      ['missing', {}],
      ['empty', { name: '' }],
      ['whitespace', { name: '   ' }],
      ['not a string', { name: 42 }],
    ])('rejects a %s name', async (_, body) => {
      const res = await api.post('/accounts').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual(expect.arrayContaining([expect.stringContaining('name')]));
    });

    it('rejects a client-set balance and creates nothing', async () => {
      const res = await api.post('/accounts').send({ name: 'Asha', balance: 500 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual(['property balance should not exist']);
      expect(await app.get(PrismaService).account.count()).toBe(0);
    });
  });

  describe('GET /accounts/:id/balance', () => {
    it('returns the balance', async () => {
      const created = await api.post('/accounts').send({ name: 'Asha' });
      const res = await api.get(`/accounts/${created.body.id}/balance`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ account_id: created.body.id, balance: 0 });
    });

    it('returns ACCOUNT_NOT_FOUND for an unknown id', async () => {
      const res = await api.get('/accounts/7f1c2e4a-0000-4000-8000-000000000000/balance');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: { code: 'ACCOUNT_NOT_FOUND', message: 'Account not found', details: null },
      });
    });

    it('returns VALIDATION_ERROR for a malformed id', async () => {
      const res = await api.get('/accounts/not-a-uuid/balance');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
