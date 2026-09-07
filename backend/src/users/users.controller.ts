import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { CreateUserDto, ResetPasswordDto, UpdateUserDto } from './dto/user.dto';

@Controller('users')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @RequirePermissions('MANAGE_USERS')
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  @RequirePermissions('MANAGE_USERS')
  findOne(@Param('id') id: string) {
    return this.usersService.findById(Number(id));
  }

  @Post()
  @RequirePermissions('MANAGE_USERS')
  create(@Body() dto: CreateUserDto, @CurrentUser() user: any) {
    return this.usersService.create(dto, user.id);
  }

  @Put(':id')
  @RequirePermissions('MANAGE_USERS')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() user: any) {
    return this.usersService.update(Number(id), dto, user.id);
  }

  @Patch(':id/disable')
  @RequirePermissions('MANAGE_USERS')
  disable(@Param('id') id: string, @CurrentUser() user: any) {
    return this.usersService.setActive(Number(id), false, user.id);
  }

  @Patch(':id/enable')
  @RequirePermissions('MANAGE_USERS')
  enable(@Param('id') id: string, @CurrentUser() user: any) {
    return this.usersService.setActive(Number(id), true, user.id);
  }

  @Patch(':id/reset-password')
  @RequirePermissions('MANAGE_USERS')
  resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto, @CurrentUser() user: any) {
    return this.usersService.resetPassword(Number(id), dto.newPassword, user.id);
  }
}
