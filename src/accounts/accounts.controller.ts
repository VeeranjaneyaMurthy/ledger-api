import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { uuidPipe } from '../api-error';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './create-account.dto';

@ApiTags('accounts')
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Post()
  create(@Body() body: CreateAccountDto) {
    return this.accounts.create(body.name);
  }

  @Get(':id/balance')
  getBalance(@Param('id', uuidPipe) id: string) {
    return this.accounts.getBalance(id);
  }
}
