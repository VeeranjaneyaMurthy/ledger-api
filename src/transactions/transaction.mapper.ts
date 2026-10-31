import { Transaction } from '@prisma/client';

export function toResponse(tx: Transaction) {
  return {
    id: tx.id,
    account_id: tx.accountId,
    type: tx.type,
    amount: Number(tx.amount),
    description: tx.description,
    reference_id: tx.referenceId,
    created_at: tx.createdAt,
  };
}
