import { MikroOrmModule } from '@mikro-orm/nestjs';
import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from './config.js';
import { HttpModule } from './http/http.module.js';
import { databaseOptions } from './database.js';
import { LiveModule } from './infrastructure/live/live.module.js';
import { OutboxModule } from './infrastructure/outbox/outbox.module.js';
import { HealthModule } from './modules/health/index.js';
import { InventoryModule } from './modules/inventory/index.js';
import { LayoutModule } from './modules/layout/index.js';
import { MovementModule } from './modules/movement/index.js';
import { ReceivingModule } from './modules/receiving/index.js';
import { AuthModule } from './modules/auth/index.js';
import { FlowModule } from './modules/flow/index.js';
import { PartnerModule } from './modules/partner/index.js';
import { DocumentsModule } from './modules/documents/index.js';
import { ShippingModule } from './modules/shipping/index.js';
import { OutboundModule } from './modules/outbound/index.js';
import { TransportOrderModule } from './modules/transport-order/index.js';
import { StrategyModule } from './modules/strategy/index.js';
import { TestSupportModule } from './modules/test-support/index.js';
import { TransportModule } from './modules/transport/index.js';

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
        MikroOrmModule.forRoot(databaseOptions(config)),
        HttpModule,
        OutboxModule,
        LiveModule,
        HealthModule,
        LayoutModule,
        TransportModule,
        StrategyModule,
        MovementModule,
        PartnerModule,
        InventoryModule,
        ReceivingModule,
        TransportOrderModule,
        FlowModule,
        OutboundModule,
        ShippingModule,
        DocumentsModule,
        AuthModule,
        ...testModules,
      ],
    };
  }
}
