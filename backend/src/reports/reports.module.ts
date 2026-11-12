import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportGeneratorService } from './report-generator.service';
import { StorageService } from './storage.service';
import { SettingsModule } from '../settings/settings.module';
import { EmailModule } from '../email/email.module';
import { MovementsModule } from '../movements/movements.module';

@Module({
  imports: [SettingsModule, EmailModule, MovementsModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportGeneratorService, StorageService],
})
export class ReportsModule {}
