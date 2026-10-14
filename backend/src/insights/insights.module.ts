import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { InsightsService } from './insights.service';
import { InsightsController } from './insights.controller';

@Module({
  imports: [SettingsModule],
  controllers: [InsightsController],
  providers: [InsightsService],
})
export class InsightsModule {}
