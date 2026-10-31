import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreateTransferDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  from_account_id: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  to_account_id: string;

  @ApiProperty({ description: 'Integer paise', example: 3000 })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amount: number;

  @ApiProperty({ example: 'TRF-1001' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  reference_id: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
