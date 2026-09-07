import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { MovementsModule } from '../movements/movements.module';

@Module({
  imports: [MovementsModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
