import { Injectable } from '@nestjs/common';
import { Prisma, Transaction } from '@prisma/client';
import { accountNotFound, ApiError, insufficientBalance, isUniqueViolation } from '../api-error';
import { PrismaService } from '../prisma.service';
import { CreateTransactionDto } from './create-transaction.dto';
import { ListTransactionsDto } from './list-transactions.dto';
import { toResponse } from './transaction.mapper';

function duplicateReference(existing: Transaction) {
  return new ApiError(409, 'DUPLICATE_REFERENCE', 'A transaction with this reference_id already exists', {
    transaction: toResponse(existing),
  });
}

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(accountId: string, dto: CreateTransactionDto) {
    try {
      return await this.prisma.$transaction((tx) => this.write(tx, accountId, dto), { timeout: 10000 });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const existing = await this.prisma.transaction.findUniqueOrThrow({
        where: { accountId_referenceId: { accountId, referenceId: dto.reference_id } },
      });
      throw duplicateReference(existing);
    }
  }

  async list(accountId: string, { page, limit, type }: ListTransactionsDto) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw accountNotFound();

    const where = { accountId, type };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { seq: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      data: rows.map(toResponse),
      page,
      page_size: limit,
      total_records: total,
      total_pages: Math.ceil(total / limit),
    };
  }

  private async write(tx: Prisma.TransactionClient, accountId: string, dto: CreateTransactionDto) {
    const [account] = await tx.$queryRaw<{ balance: bigint }[]>`
      SELECT balance FROM accounts WHERE id = ${accountId}::uuid FOR UPDATE`;
    if (!account) throw accountNotFound();

    const existing = await tx.transaction.findUnique({
      where: { accountId_referenceId: { accountId, referenceId: dto.reference_id } },
    });
    if (existing) throw duplicateReference(existing);

    const amount = BigInt(dto.amount);
    if (dto.type === 'debit' && account.balance < amount) {
      throw insufficientBalance(account.balance, amount);
    }

    const created = await tx.transaction.create({
      data: {
        accountId,
        type: dto.type,
        amount,
        description: dto.description,
        referenceId: dto.reference_id,
      },
    });
    await tx.account.update({
      where: { id: accountId },
      data: { balance: dto.type === 'credit' ? { increment: amount } : { decrement: amount } },
    });
    return toResponse(created);
  }
}
