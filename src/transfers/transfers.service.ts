import { Injectable } from '@nestjs/common';
import { Prisma, Transaction } from '@prisma/client';
import { accountNotFound, ApiError, insufficientBalance, isUniqueViolation } from '../api-error';
import { PrismaService } from '../prisma.service';
import { toResponse } from '../transactions/transaction.mapper';
import { CreateTransferDto } from './create-transfer.dto';

function duplicateReference(existing: Transaction[]) {
  return new ApiError(409, 'DUPLICATE_REFERENCE', 'A transaction with this reference_id already exists', {
    transactions: existing.map(toResponse),
  });
}

function findByReference(client: Prisma.TransactionClient, dto: CreateTransferDto) {
  return client.transaction.findMany({
    where: {
      accountId: { in: [dto.from_account_id, dto.to_account_id] },
      referenceId: dto.reference_id,
    },
    orderBy: { seq: 'asc' },
  });
}

@Injectable()
export class TransfersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTransferDto) {
    if (dto.from_account_id === dto.to_account_id) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid request', [
        'from_account_id and to_account_id must be different',
      ]);
    }
    try {
      return await this.prisma.$transaction((tx) => this.write(tx, dto), { timeout: 10000 });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      throw duplicateReference(await findByReference(this.prisma, dto));
    }
  }

  private async write(tx: Prisma.TransactionClient, dto: CreateTransferDto) {
    const { from_account_id: fromId, to_account_id: toId, reference_id: referenceId, description } = dto;

    const rows = await tx.$queryRaw<{ id: string; balance: bigint }[]>`
      SELECT id, balance FROM accounts
      WHERE id IN (${fromId}::uuid, ${toId}::uuid)
      ORDER BY id
      FOR UPDATE`;
    const source = rows.find((r) => r.id === fromId);
    if (!source) throw accountNotFound({ account_id: fromId });
    if (!rows.some((r) => r.id === toId)) throw accountNotFound({ account_id: toId });

    const existing = await findByReference(tx, dto);
    if (existing.length > 0) throw duplicateReference(existing);

    const amount = BigInt(dto.amount);
    if (source.balance < amount) throw insufficientBalance(source.balance, amount);

    const debit = await tx.transaction.create({
      data: { accountId: fromId, type: 'debit', amount, description, referenceId },
    });
    const credit = await tx.transaction.create({
      data: { accountId: toId, type: 'credit', amount, description, referenceId },
    });
    await tx.account.update({ where: { id: fromId }, data: { balance: { decrement: amount } } });
    await tx.account.update({ where: { id: toId }, data: { balance: { increment: amount } } });

    return {
      reference_id: referenceId,
      amount: dto.amount,
      debit: toResponse(debit),
      credit: toResponse(credit),
    };
  }
}
