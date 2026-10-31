# Ledger API

A transaction ledger API: accounts, credits and debits, balances, paginated history and transfers. Built with NestJS, Prisma and PostgreSQL.

- [API.md](API.md): endpoints, requests, responses and error codes
- [ASSUMPTIONS.md](ASSUMPTIONS.md): every assumption made where the spec is silent
- Swagger: `http://localhost:3000/docs` once the app is running

## Requirements

- Docker with Docker Compose
- Node.js 22+ (only for running tests or the app outside Docker)

## Run with Docker

```bash
docker compose up --build
```

This starts PostgreSQL and the API on `http://localhost:3000`. The API container applies migrations before it starts.

## Run locally

```bash
npm ci
cp .env.example .env
docker compose up -d db
npx prisma migrate deploy
npm run start:dev
```

## Tests

```bash
npm ci
docker compose up -d db-test
npm test
npm run test:e2e
```

- `npm test` runs unit tests.
- `npm run test:e2e` applies migrations to the test database (port 5433, settings in `.env.test`) and runs the end-to-end tests serially.

## How data integrity is enforced

- **Atomicity:** each transaction or transfer runs in one database transaction. The account row is locked with `SELECT … FOR UPDATE` before the balance is read, so concurrent requests on the same account run one at a time.
- **Balance:** the service rejects debits larger than the balance, and a `CHECK (balance >= 0)` constraint backs it up.
- **Duplicates:** a unique constraint on `(account_id, reference_id)`.
- **Transfers:** both accounts are locked in one query ordered by id, so opposite-direction transfers can't deadlock.
- **Immutability:** there are no update or delete routes for transactions, and a database trigger rejects `UPDATE` and `DELETE` on the `transactions` table.

## Project layout

```
prisma/          schema and migrations (CHECK constraints and trigger are in the init migration)
src/accounts/    create account, get balance
src/transactions/ add transaction, history
src/transfers/   transfers
src/error.filter.ts  maps every error to { error: { code, message, details } }
test/            end-to-end tests
```
