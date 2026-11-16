import { Controller, Get } from '@nestjs/common';
import { ApiDocumentation } from './api-documentation.js';

@Controller()
export class OpenApiController {
  constructor(private readonly documentation: ApiDocumentation) {}

  @Get('openapi.json')
  getDocument(): unknown {
    return this.documentation.generate();
  }
}
