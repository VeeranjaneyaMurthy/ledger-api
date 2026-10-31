import { Injectable } from '@nestjs/common';
import { Account } from '@prisma/client';
import { accountNotFound } from '../api-error';
import { PrismaService } from '../prisma.service';

function toResponse(account: Account) {
  return {
    id: account.id,
    name: account.name,
    balance: Number(account.balance),
    created_at: account.createdAt,
  };
}

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(name: string) {
    const account = await this.prisma.account.create({ data: { name } });
    return toResponse(account);
  }

  async getBalance(id: string) {
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account) throw accountNotFound();
    return { account_id: account.id, balance: Number(account.balance) };
  }
}
