import { IsIn, IsNumberString, IsOptional, IsString } from 'class-validator';
import { TEAMS } from '../../common/constants/teams';
import { DAY_SCOPES, DayScope } from '../../common/utils/day-range';

const METRICS = ['attendance', 'shortfall', 'longDuration', 'missingExit', 'missingEntry', 'corrected', 'unit', 'team', 'hour'] as const;
export type DrillDownMetric = (typeof METRICS)[number];

export class DrillDownQueryDto {
  @IsIn(METRICS)
  metric: DrillDownMetric;

  // Required for attendance (a single day). Optional for
  // shortfall/longDuration/missingExit/missingEntry — present when
  // scoping to one day (a chart bar click), absent when scoping to the
  // whole from/to range (a range-level summary card, which has no single
  // day to point to). Ignored by unit/team/corrected, which are always
  // range-scoped via from/to.
  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  // Required for metric=team; also usable as an extra filter on
  // attendance/shortfall/missingExit/unit, same as the main summary.
  @IsOptional()
  @IsIn(TEAMS)
  team?: string;

  // Required for metric=unit; also usable as an extra filter elsewhere.
  @IsOptional()
  @IsNumberString()
  unitId?: string;

  // Required for metric=hour — the clicked hour-of-day bucket (0-23),
  // app timezone, matching Hourly Entry & Exit Distribution's own bucketing.
  @IsOptional()
  @IsNumberString()
  hour?: string;

  // Only meaningful for attendance/unit (raw movement listings) — ignored
  // by shortfall/missingExit/team, which are already ENTRY+EXIT-paired
  // and would be misleading if one side were filtered out.
  @IsOptional()
  @IsIn(['ENTRY', 'EXIT'])
  movementType?: 'ENTRY' | 'EXIT';

  // Only meaningful for shortfall/longDuration/missingExit/missingEntry/team
  // (the analytics metrics) — ignored by the raw-record metrics
  // (attendance/unit/hour/corrected), same split as everywhere else.
  @IsOptional()
  @IsIn(DAY_SCOPES)
  dayScope?: DayScope;
}
