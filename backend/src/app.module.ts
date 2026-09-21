import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AuditLogModule } from './audit-logs/audit-log.module';
import { EmployeesModule } from './employees/employees.module';
import { MovementsModule } from './movements/movements.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ReportsModule } from './reports/reports.module';
import { EmailModule } from './email/email.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { PermissionsModule } from './permissions/permissions.module';
import { SettingsModule } from './settings/settings.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    AuditLogModule,
    EmployeesModule,
    MovementsModule,
    DashboardModule,
    ReportsModule,
    EmailModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    SettingsModule,
    HealthModule,
  ],
  providers: [
    // @Throttle(...) on individual routes only sets metadata — without a
    // guard actually reading it, rate limiting silently does nothing.
    // Registered globally so any future @Throttle() elsewhere works too.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
