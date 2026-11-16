import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { ApiDocumentation } from './openapi/api-documentation.js';
import { OpenApiController } from './openapi/openapi.controller.js';

@Global()
@Module({
  providers: [ApiDocumentation, { provide: APP_FILTER, useClass: ApiExceptionFilter }],
  controllers: [OpenApiController],
  exports: [ApiDocumentation],
})
export class HttpModule {}
