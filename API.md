# API

Base URL: `http://localhost:3000`. Interactive docs (Swagger): `http://localhost:3000/docs`.

## Conventions
- Requests and responses are JSON with snake_case fields.
- Money is integer paise.
- Timestamps are ISO 8601 in UTC.
- Unknown body fields and unknown query parameters are rejected with 400.

## Errors

Every error has the same shape:

```json
{ "error": { "code": "INSUFFICIENT_BALANCE", "message": "Insufficient balance", "details": { "balance": 100, "amount": 150 } } }
```

| Status | Code | When | `details` |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid body, query or id; malformed JSON; same-account transfer | List of messages |
| 404 | `ACCOUNT_NOT_FOUND` | Account doesn't exist | `null`, or `{ account_id }` for transfers |
| 404 | `NOT_FOUND` | Unknown route, including PUT/PATCH/DELETE on transactions | `null` |
| 409 | `DUPLICATE_REFERENCE` | `reference_id` already used on the account | `{ transaction }` or, for transfers, `{ transactions }` |
| 422 | `INSUFFICIENT_BALANCE` | Debit or transfer larger than the balance | `{ balance, amount }` |
| 500 | `INTERNAL_ERROR` | Unexpected error | `null` |

## Create account

`POST /accounts`

| Field | Type | Rules |
|---|---|---|
| `name` | string | Required, not blank. Trimmed. |

The balance can't be set by the client; sending `balance` returns 400.

```json
// 201 Created
{ "id": "3f0c…", "name": "Asha", "balance": 0, "created_at": "2026-10-31T10:00:00.000Z" }
```

Errors: 400.

## Get balance

`GET /accounts/:id/balance`

```json
// 200 OK
{ "account_id": "3f0c…", "balance": 15000 }
```

Errors: 400 (bad id), 404 `ACCOUNT_NOT_FOUND`.

## Add transaction

`POST /accounts/:id/transactions`

| Field | Type | Rules |
|---|---|---|
| `type` | string | `credit` or `debit` |
| `amount` | integer | Paise, greater than 0 |
| `reference_id` | string | Required, not blank. Trimmed. Unique per account. |
| `description` | string | Optional |

```json
// 201 Created
{
  "id": "9a1e…",
  "account_id": "3f0c…",
  "type": "credit",
  "amount": 15000,
  "description": "Salary",
  "reference_id": "INV-1001",
  "created_at": "2026-10-31T10:01:00.000Z"
}
```

A credit adds `amount` to the balance and a debit subtracts it. The transaction and the balance change are saved together or not at all.

Errors:
- 400: invalid body or id.
- 404 `ACCOUNT_NOT_FOUND`.
- 409 `DUPLICATE_REFERENCE`: `details.transaction` is the original. Nothing is created and the balance doesn't change.
- 422 `INSUFFICIENT_BALANCE`: debit larger than the balance. The balance doesn't change.

## Transaction history

`GET /accounts/:id/transactions?type=&page=&limit=`

| Query | Default | Rules |
|---|---|---|
| `type` | both | `credit` or `debit` |
| `page` | 1 | Integer ≥ 1 |
| `limit` | 10 | Integer 1–100 |

Sorted latest first by `created_at`. `total_records` and `total_pages` count only transactions matching `type`.

```json
// 200 OK
{
  "data": [ { "id": "9a1e…", "account_id": "3f0c…", "type": "credit", "amount": 15000, "description": null, "reference_id": "INV-1001", "created_at": "…" } ],
  "page": 1,
  "page_size": 10,
  "total_records": 1,
  "total_pages": 1
}
```

A page past the end returns 200 with `data: []`.

Errors: 400 (bad id, `type`, `page` or `limit`), 404 `ACCOUNT_NOT_FOUND`.

## Transfer

`POST /transfers`

| Field | Type | Rules |
|---|---|---|
| `from_account_id` | UUID | Must exist |
| `to_account_id` | UUID | Must exist, different from `from_account_id` |
| `amount` | integer | Paise, greater than 0 |
| `reference_id` | string | Required, not blank. Trimmed. Must not exist on either account. |
| `description` | string | Optional |

Creates a debit on the source and a credit on the destination with the same `reference_id`. Both legs and both balance changes are saved together or not at all.

```json
// 201 Created
{
  "reference_id": "TRF-1",
  "amount": 3000,
  "debit":  { "id": "…", "account_id": "<from>", "type": "debit",  "amount": 3000, "description": null, "reference_id": "TRF-1", "created_at": "…" },
  "credit": { "id": "…", "account_id": "<to>",   "type": "credit", "amount": 3000, "description": null, "reference_id": "TRF-1", "created_at": "…" }
}
```

Errors:
- 400: invalid body, or the same account on both sides.
- 404 `ACCOUNT_NOT_FOUND`: `details.account_id` names the missing account.
- 409 `DUPLICATE_REFERENCE`: `details.transactions` lists the existing transactions with that reference.
- 422 `INSUFFICIENT_BALANCE`: source balance too low.

## Unsupported methods

Transactions can't be edited or deleted. PUT, PATCH and DELETE on `/accounts/:id/transactions` or `/accounts/:id/transactions/:txId` return 404 `NOT_FOUND` because those routes don't exist. 405 was considered; 404 was chosen so there are no handlers whose only job is to refuse.
