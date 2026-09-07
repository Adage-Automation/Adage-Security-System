import { Global, Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { AuditLogController } from './audit-log.controller';

// Global: nearly every module (auth, employees, movements, users, settings,
// reports) writes to the audit trail, so it's registered globally like
// PrismaModule rather than requiring every consumer to import it.
@Global()
@Module({
  controllers: [AuditLogController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
