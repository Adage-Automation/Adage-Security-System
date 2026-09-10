import { BadRequestException, Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SETTING_KEYS } from '../common/constants/settings-keys';
import { SettingsService } from './settings.service';

@Controller('settings')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  @Get()
  @RequirePermissions('MANAGE_SETTINGS')
  getAll() {
    return this.settingsService.getAll();
  }

  @Put(':key')
  @RequirePermissions('MANAGE_SETTINGS')
  set(@Param('key') key: string, @Body('value') value: string, @CurrentUser() user: any) {
    if (!(SETTING_KEYS as readonly string[]).includes(key)) {
      throw new BadRequestException(`Unknown setting key "${key}"`);
    }
    return this.settingsService.set(key, value, user.id);
  }
}
