import { Controller, Get, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('roles')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class RolesController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @RequirePermissions('MANAGE_USERS')
  findAll() {
    return this.prisma.role.findMany({
      include: { rolePermissions: { include: { permission: true } } },
    });
  }
}
