import { MikroOrmModule } from '@mikro-orm/nestjs';
import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from './config.js';
import { HttpModule } from './http/http.module.js';
import { createOrmOptions } from './infrastructure/database/orm-options.js';
import { OutboxModule } from './infrastructure/outbox/outbox.module.js';
import { HealthModule } from './modules/health/index.js';
import { TestSupportModule } from './modules/test-support/index.js';

@Global()
@Module({})
class ConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}

@Module({})
export class AppModule {
  /**
   * Fachmodule werden hier eingehängt. Test-Endpunkte gibt es nur im
   * Profil `test` – im Profil `production` existieren sie nicht.
   */
  static forRoot(config: AppConfig): DynamicModule {
    const testModules = config.profile === 'test' ? [TestSupportModule] : [];
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        MikroOrmModule.forRoot(createOrmOptions(config)),
        HttpModule,
        OutboxModule,
        HealthModule,
        ...testModules,
      ],
    };
  }
}
