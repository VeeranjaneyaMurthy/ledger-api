import { INestApplication, ValidationError, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiError } from './api-error';
import { ErrorFilter } from './error.filter';

function validationMessages(errors: ValidationError[]): string[] {
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

export function configureApp(app: INestApplication) {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new ApiError(400, 'VALIDATION_ERROR', 'Invalid request', validationMessages(errors)),
    }),
  );
  app.useGlobalFilters(new ErrorFilter());

  const config = new DocumentBuilder().setTitle('Ledger API').setVersion('1.0').build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
}
