import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { uuidPipe } from '../api-error';
import { CreateTransactionDto } from './create-transaction.dto';
import { ListTransactionsDto } from './list-transactions.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('transactions')
@Controller('accounts/:id/transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post()
  create(@Param('id', uuidPipe) id: string, @Body() body: CreateTransactionDto) {
    return this.transactions.create(id, body);
  }

  @Get()
  list(@Param('id', uuidPipe) id: string, @Query() query: ListTransactionsDto) {
    return this.transactions.list(id, query);
  }
}
