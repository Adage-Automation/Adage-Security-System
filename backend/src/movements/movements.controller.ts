import { Body, Controller, ForbiddenException, Get, Param, ParseIntPipe, Post, Query, UseGuards, Req } from '@nestjs/common';
import { Request } from 'express';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { parseOptionalInt } from '../common/utils/parse-optional-int';
import { MovementsService } from './movements.service';
import { CreateMovementDto, CorrectMovementDto } from './dto/movement.dto';

@Controller('movements')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class MovementsController {
  constructor(private movementsService: MovementsService) {}

  // No blanket @RequirePermissions here: PermissionsGuard ANDs multiple
  // required permissions, so declaring both RECORD_ENTRY and RECORD_EXIT
  // would wrongly demand a guard hold both just to record either one alone
  // (latent today since every role that has one has both — but it would
  // silently break a future entry-only/exit-only role split). Checked
  // per movementType instead — found in the 2026-09-04 audit.
  @Post()
  create(@Body() dto: CreateMovementDto, @CurrentUser() user: any, @Req() req: Request) {
    const required = dto.movementType === 'ENTRY' ? 'RECORD_ENTRY' : 'RECORD_EXIT';
    if (!user.permissions?.includes(required)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return this.movementsService.createMovement(dto, user.id, req.ip, req.headers['user-agent'] as string);
  }

  @Get()
  @RequirePermissions('VIEW_DASHBOARD')
  list(
    @Query('date') date?: string,
    @Query('employeeId') employeeId?: string,
    @Query('movementType') movementType?: 'ENTRY' | 'EXIT',
  ) {
    return this.movementsService.listWithFilters({
      date,
      employeeId: parseOptionalInt(employeeId, 'employeeId'),
      movementType,
    });
  }

  @Get('employee/:id')
  @RequirePermissions('VIEW_EMPLOYEE_HISTORY')
  listForEmployee(@Param('id', ParseIntPipe) id: number, @Query('date') date: string) {
    return this.movementsService.listByEmployeeAndDate(id, date);
  }

  @Post(':id/correct')
  @RequirePermissions('CORRECT_RECORDS')
  correct(@Param('id', ParseIntPipe) id: number, @Body() dto: CorrectMovementDto, @CurrentUser() user: any) {
    return this.movementsService.correctMovement(id, dto, user.id);
  }

  @Post('missing')
  @RequirePermissions('CORRECT_RECORDS')
  addMissing(@Body() dto: CorrectMovementDto, @CurrentUser() user: any) {
    return this.movementsService.addMissingRecord(dto, user.id);
  }
}
