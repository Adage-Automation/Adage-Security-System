import { IsIn, IsNumberString, IsOptional, IsString } from 'class-validator';
import { TEAMS } from '../../common/constants/teams';
import { DAY_SCOPES, DayScope } from '../../common/utils/day-range';

// Spec item #5 (Employee-wise Daily Duration): unlike every other Insights
// view, this one is scoped to a single day, not a from/to range — with
// 200+ employees, a range view would mean hundreds of rows per day,
// exactly what this table-only view (not a chart — see Insights.tsx) is
// meant to avoid making worse.
export class DailyDurationQueryDto {
  @IsString()
  date: string;

  @IsOptional()
  @IsIn(TEAMS)
  team?: string;

  @IsOptional()
  @IsNumberString()
  unitId?: string;

  // Only affects whether a tap-free roster member counts as "no movement"
  // on this specific date — see getDailyDuration's comment.
  @IsOptional()
  @IsIn(DAY_SCOPES)
  dayScope?: DayScope;
}
