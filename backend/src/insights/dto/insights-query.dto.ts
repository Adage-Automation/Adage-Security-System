import { IsIn, IsNumberString, IsOptional, IsString } from 'class-validator';
import { TEAMS } from '../../common/constants/teams';
import { DAY_SCOPES, DayScope } from '../../common/utils/day-range';

// `from`/`to` are deliberately plain strings here, not @IsDateString() —
// dateRangeInclusive() (common/utils/day-range.ts) already validates the
// exact YYYY-MM-DD format with a clear 400 message; double-validating
// with class-validator's looser ISO8601 rules would just risk the two
// disagreeing on some edge case.
export class InsightsQueryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsIn(TEAMS)
  team?: string;

  // The recordedByUserId to filter to (a specific security unit) — kept as
  // a numeric id, not a role/username guess, so it works regardless of how
  // many security-unit accounts exist.
  @IsOptional()
  @IsNumberString()
  unitId?: string;

  // Only affects the entry/exit *tally* charts (attendance trend, hourly
  // distribution, unit activity, team entries/exits) — duration-based
  // figures (avg duration, shortfall, missing exits) always need both an
  // ENTRY and EXIT to mean anything, so they ignore this filter entirely
  // rather than silently turning every day into a "missing exit".
  @IsOptional()
  @IsIn(['ENTRY', 'EXIT'])
  movementType?: 'ENTRY' | 'EXIT';

  // Which days count toward every rate/average/trend on this page — see
  // DAY_SCOPES. Defaults to 'weekdays' when absent.
  @IsOptional()
  @IsIn(DAY_SCOPES)
  dayScope?: DayScope;
}
