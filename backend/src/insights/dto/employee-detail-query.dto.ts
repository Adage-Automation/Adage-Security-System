import { IsIn, IsNumberString, IsOptional, IsString } from 'class-validator';
import { DAY_SCOPES, DayScope } from '../../common/utils/day-range';

export class EmployeeDetailQueryDto {
  @IsNumberString()
  employeeId: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsIn(DAY_SCOPES)
  dayScope?: DayScope;
}
