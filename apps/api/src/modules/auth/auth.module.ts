import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthService } from './application/auth.service.js';
import { AuthGuard } from './http/auth.guard.js';
import { AuthController } from './http/auth.controller.js';
import { UsersController } from './http/users.controller.js';

/** Anmeldung, Rollen und Benutzerverwaltung; der Guard schützt alle Controller. */
@Module({
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  controllers: [AuthController, UsersController],
  exports: [AuthService],
})
export class AuthModule {}
