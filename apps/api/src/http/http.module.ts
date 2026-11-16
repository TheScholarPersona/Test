import { Global, Module } from '@nestjs/common';
import { ApiDocumentation } from './openapi/api-documentation.js';
import { OpenApiController } from './openapi/openapi.controller.js';

@Global()
@Module({
  providers: [ApiDocumentation],
  controllers: [OpenApiController],
  exports: [ApiDocumentation],
})
export class HttpModule {}
