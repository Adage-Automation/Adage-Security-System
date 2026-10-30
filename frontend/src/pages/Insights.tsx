import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChartConfiguration } from 'chart.js';
import { api } from '../api/client';
import { Employee } from '../types';
import { AdminNav } from '../components/AdminNav';
import { BackToTop } from '../components/BackToTop';
import { ChartCanvas } from '../components/ChartCanvas';
import { EmployeeLink } from '../components/EmployeeLink';
import { IconBarChart, IconCheck, IconChevronRight, IconFilter, IconInbox, IconSearch, IconUsers, IconX } from '../components/icons';
import { TableSkeleton } from '../components/TableSkeleton';
import { useScrollRestoration } from '../hooks/useScrollRestoration';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { saveSessionState, loadSessionState } from '../utils/sessionState';
import { downloadFile } from '../utils/downloadFile';
import { todayIso, isoDaysAgo, startOfWeekIso, startOfMonthIso, attendanceMonthRange, formatTime } from '../utils/date';

// Chart colors mirror the app's brand palette (global.css --brand/--brand-dark/
// --exit-red/--pending-amber). EXIT_RED and AMBER used to be different hex
// values from the actual tokens (a drift, not a deliberate choice) — a chart's
// "Exits"/"Missing" bar read as a visibly different red/amber than the EXIT
// badge or pending banner seen elsewhere in the app. Found in the 2026-10-29 audit.
const BRAND = '#0d828b';
const BRAND_DARK = '#085156';
const EXIT_RED = '#be123c';
const AMBER = '#92700a';
const MUTED = '#94a3a8';

interface UnitActivity {
  unitId: number;
  unitName: string;
  entries: number;
  exits: number;
}

interface InsightsSummary {
  range: { from: string; to: string };
  shiftReference: { start: string; end: string; expectedHours: number };
  attendanceTrend: Array<{ date: string; entries: number; exits: number }>;
  hourlyDistribution: Array<{ hour: number; entries: number; exits: number }>;
  uniqueEmployeesByDay: Array<{ date: string; count: number }>;
  totalRosterSize: number;
  avgDurationTrend: Array<{ date: string; avgHours: number | null }>;
  exceptions: { missingEntries: number; missingExits: number; correctedRecords: number };
  hoursShortfall: { shortfallDays: number; totalEmployeeDays: number; trend: Array<{ date: string; shortfallCount: number }> };
  hoursLongDuration: { longDurationDays: number; totalEmployeeDays: number; threshold: number; trend: Array<{ date: string; longDurationCount: number }> };
  missingExits: { count: number; trend: Array<{ date: string; count: number; missingEntryCount: number }> };
  unitActivity: UnitActivity[];
  teamBreakdown: Array<{
    team: string;
    entries: number;
    exits: number;
    employeeCount: number;
    employeeDays: number;
    daysWithHoursTracked: number;
    avgHours: number | null;
    medianHours: number | null;
    shortfallDays: number;
    longDurationDays: number;
  }>;
}

type TeamBreakdownRow = InsightsSummary['teamBreakdown'][number];

interface DailyDurationRow {
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  team: string | null;
  hours: number | null;
  // 'missingBoth' — an orphan leading exit AND a still-open trailing
  // entry are independent, not mutually exclusive. Added 2026-10-28.
  status: 'complete' | 'missingExit' | 'missingEntry' | 'missingBoth';
}

// Deliberately not "absent" — see getDailyDuration's comment on the
// backend. A tap-free day could just as easily be approved leave, a
// holiday, remote work, or a forgotten tap.
interface NoMovementRow {
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  team: string | null;
  isActive: boolean;
}

interface EmployeeDetail {
  employee: { id: number; employeeName: string; employeeCode: string; team: string | null; isActive: boolean };
  range: { from: string; to: string };
  avgArrival: string | null;
  avgDeparture: string | null;
  dailyHours: Array<{ date: string; hours: number | null; missingExit: boolean }>;
  dailyCounts: Array<{ date: string; entries: number; exits: number }>;
  employeeAvgHours: number | null;
  employeeDurationBucket: number | null;
  durationDistribution: Array<{ hours: number; count: number; employees: Array<{ name: string; hours: number }> }>;
}

type DrillDownMetric = 'attendance' | 'shortfall' | 'longDuration' | 'missingExit' | 'missingEntry' | 'corrected' | 'unit' | 'team' | 'hour';

interface DrillDownState {
  metric: DrillDownMetric;
  title: string;
  rows: any[];
  loading: boolean;
  error: string | null;
  // The single day this drill-down is scoped to, if any (attendance/
  // shortfall/missingExit are opened with a specific date; team/unit
  // aren't — they cover the whole filter range instead).
  date?: string;
  // The exact params it was opened with, reused verbatim to build the
  // export URL so the download can never disagree with what's on screen.
  params: Record<string, string>;
  // Backend hit its row cap (500) and silently dropped the rest — surfaced
  // here instead of nowhere, matching the same warning the Excel export
  // now shows. Found in the 2026-10-28 audit.
  truncated?: boolean;
}

interface DrillDownIntent {
  metric: DrillDownMetric;
  params: Record<string, string>;
  title: string;
}

// Labels a y-axis with what its numbers actually count (movements, hours,
// days, employees…) — without it, a dual-axis chart's two scales are only
// distinguishable by legend color, easy to misread. Added 2026-10-13, by
// request ("on all axes show what that count is").
function axisTitle(text: string, color: string = MUTED) {
  return { display: true, text, font: { size: 11, weight: 600 as const }, color };
}

const baseLineOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'bottom' as const } },
  scales: { y: { beginAtZero: true, ticks: { precision: 0 }, title: axisTitle('Count') } },
};

// Turns a bar/point click into a callback carrying the clicked index, and
// shows a pointer cursor on hover so it's visually obvious the chart is
// clickable — Chart.js's own onClick/onHover options, not a custom overlay.
function clickableOptions(onPick: (index: number) => void) {
  return {
    onClick: (_evt: any, elements: any[]) => {
      if (elements.length > 0) onPick(elements[0].index);
    },
    onHover: (evt: any, elements: any[]) => {
      if (evt.native?.target) (evt.native.target as HTMLElement).style.cursor = elements.length ? 'pointer' : 'default';
    },
  };
}

const FILTERS_KEY = 'insights:filters';
const EMPLOYEE_KEY = 'insights:selectedEmployee';
const DRILLDOWN_KEY = 'insights:drilldown';
const DEPT_COMPARISON_TEAMS_KEY = 'insights:deptComparisonTeams';
const DEPT_COMPARISON_EXPANDED_KEY = 'insights:deptComparisonExpanded';

type DayScope = 'weekdays' | 'all' | 'weekends';
const DAY_SCOPE_OPTIONS: Array<{ value: DayScope; label: string }> = [
  { value: 'weekdays', label: 'Without weekends' },
  { value: 'all', label: 'With weekends' },
  { value: 'weekends', label: 'Just weekends' },
];

export function Insights() {
  const navigate = useNavigate();
  // Restored from sessionStorage so navigating to an employee's day and
  // coming back lands on the same filters/drill-down, not a reset page.
  const [restoredFilters] = useState(() =>
    loadSessionState<{ from: string; to: string; team: string; unitId: string; movementType: '' | 'ENTRY' | 'EXIT'; dayScope: DayScope }>(FILTERS_KEY, {
      from: isoDaysAgo(29),
      to: todayIso(),
      team: '',
      unitId: '',
      movementType: '',
      dayScope: 'weekdays',
    }),
  );
  const [from, setFrom] = useState(restoredFilters.from);
  const [to, setTo] = useState(restoredFilters.to);
  const [team, setTeam] = useState(restoredFilters.team);
  const [unitId, setUnitId] = useState(restoredFilters.unitId);
  const [dayScope, setDayScope] = useState<DayScope>(restoredFilters.dayScope ?? 'weekdays');
  const [movementType, setMovementType] = useState<'' | 'ENTRY' | 'EXIT'>(restoredFilters.movementType);
  // Team/Unit/Movement/Days (plus the Employee lookup) collapse behind a
  // "Filters" toggle — closed by default, so the card's at-rest height is
  // just the date-range row. Expands a second row inside the same card
  // (not a floating popover) when opened. Added 2026-10-16, by request.
  const [filtersOpen, setFiltersOpen] = useState(true);
  // Which attendance-cycle (26th–25th) the ◀ ▶ arrows are currently on,
  // relative to the current one (0). Only meaningful while that preset is
  // the active one — see isAttendanceMonthActive below.
  const [attendanceMonthOffset, setAttendanceMonthOffset] = useState(0);
  // Cached after the first "All Time" click so re-clicking doesn't refetch.
  const [earliestMovementDate, setEarliestMovementDate] = useState<string | null>(null);
  const [allTimeLoading, setAllTimeLoading] = useState(false);
  const [teams, setTeams] = useState<string[]>([]);
  // Discovered once from an unfiltered fetch so the Unit dropdown still
  // offers every unit even while a team/unit filter narrows the actual
  // chart data to fewer of them — see comment on the effect below.
  const [knownUnits, setKnownUnits] = useState<UnitActivity[]>([]);
  const [summary, setSummary] = useState<InsightsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const [drillDown, setDrillDown] = useState<DrillDownState | null>(null);
  const [distributionBucket, setDistributionBucket] = useState<{ hours: number; employees: Array<{ name: string; hours: number }> } | null>(null);
  const distributionBucketModalRef = useRef<HTMLDivElement>(null);
  const distributionBucketCloseRef = useRef<HTMLButtonElement>(null);
  const drillDownSeqRef = useRef(0);
  const drillDownModalRef = useRef<HTMLDivElement>(null);
  const drillDownCloseRef = useRef<HTMLButtonElement>(null);
  // Search/sort are local to whichever drill-down is open — reset every
  // time a new one opens so a leftover search term from the last modal
  // doesn't silently hide rows in this one. Only filters what's on
  // screen; Export to Excel always exports the full, unfiltered list.
  const [drillDownSearch, setDrillDownSearch] = useState('');
  const [drillDownTeamFilter, setDrillDownTeamFilter] = useState<string[]>([]);
  // Which departments to show in Department Comparison — empty means "all"
  // (same convention as the other TeamMultiSelect filters on this page).
  // Local to this one chart, not the page-wide Team filter (that one's
  // single-select and scoped to the whole page — picking it would narrow
  // every chart to one team, leaving nothing left to compare; see
  // deptComparisonBreakdown below, which is fetched ignoring the top Team
  // filter for exactly this reason). Persisted (unlike the other
  // TeamMultiSelect filters, which are deliberately transient
  // per-modal-open) since revisiting the same department shortlist across
  // page reloads is the actual use case here. Added 2026-10-13, by request.
  const [deptComparisonTeamFilter, setDeptComparisonTeamFilter] = useState<string[]>(() =>
    loadSessionState<string[]>(DEPT_COMPARISON_TEAMS_KEY, []),
  );
  // Collapsed by default — this is the single heaviest section on the page
  // (three full-width charts), and not everyone needs it on every visit.
  // Persisted per session since someone who does open it is likely to want
  // it open again on the next filter change/reload, not re-expand every
  // time. Direct user feedback, 2026-10-14.
  const [deptComparisonExpanded, setDeptComparisonExpanded] = useState(() => loadSessionState<boolean>(DEPT_COMPARISON_EXPANDED_KEY, false));
  // Independent sort direction per Department Comparison chart — each
  // metric is now its own chart, so each gets its own sort instead of
  // inheriting another metric's order. All default to highest first.
  // Direct user feedback, 2026-10-13.
  const [medianSortDir, setMedianSortDir] = useState<'asc' | 'desc'>('desc');
  const [shortfallSortDir, setShortfallSortDir] = useState<'asc' | 'desc'>('desc');
  const [overtimeSortDir, setOvertimeSortDir] = useState<'asc' | 'desc'>('desc');
  const [drillDownSort, setDrillDownSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [teamTableSort, setTeamTableSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  // Per-employee view — a search box picks any employee (not tied to a
  // chart click), same search-dropdown pattern as Dashboard.tsx.
  const [employeeQuery, setEmployeeQuery] = useState('');
  const [employeeResults, setEmployeeResults] = useState<Employee[]>([]);
  const [employeeDropdownOpen, setEmployeeDropdownOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(() => loadSessionState<Employee | null>(EMPLOYEE_KEY, null));
  const [employeeDetail, setEmployeeDetail] = useState<EmployeeDetail | null>(null);
  const [employeeDetailLoading, setEmployeeDetailLoading] = useState(false);
  const [employeeDetailError, setEmployeeDetailError] = useState<string | null>(null);
  const employeeSearchRef = useRef<HTMLDivElement>(null);
  const employeeSearchSeqRef = useRef(0);
  const employeeDetailSeqRef = useRef(0);

  // Spec item #5 — table-only, one selected day across every employee
  // with a movement that day (not the whole roster — see getDailyDuration's
  // comment). Defaults to the filter range's end date.
  const [dailyDurationDate, setDailyDurationDate] = useState(to);
  const [dailyDuration, setDailyDuration] = useState<DailyDurationRow[] | null>(null);
  // Roster members with zero taps that day — see NoMovementRow's comment
  // on why this isn't called "absent". Added 2026-10, by request.
  const [dailyDurationNoMovement, setDailyDurationNoMovement] = useState<NoMovementRow[] | null>(null);
  const [dailyDurationView, setDailyDurationView] = useState<'present' | 'noMovement'>('present');
  const [dailyDurationLoading, setDailyDurationLoading] = useState(false);
  const [dailyDurationError, setDailyDurationError] = useState<string | null>(null);
  const [dailyDurationQuery, setDailyDurationQuery] = useState('');
  // Local to the modal, same as a drill-down's team filter — lets you
  // narrow to one team without leaving the modal when the top Team filter
  // is left on "All teams".
  const [dailyDurationTeamFilter, setDailyDurationTeamFilter] = useState<string[]>([]);
  const [dailyDurationSort, setDailyDurationSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const dailyDurationSeqRef = useRef(0);
  // Moved into a modal (2026-10) — was a permanently-inline table, making
  // an already-long page longer whether or not anyone needed it that visit.
  const [dailyDurationOpen, setDailyDurationOpen] = useState(false);
  const dailyDurationModalRef = useRef<HTMLDivElement>(null);
  const dailyDurationCloseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    api
      .get<string[]>('/employees/teams')
      .then(setTeams)
      .catch(() => setTeams([]));
  }, []);

  // Seeds the Unit filter's options from the default (unfiltered, last
  // 30 days) range once on load. A unit only active outside that window
  // won't appear as a filter option — an accepted v1 simplification
  // rather than adding a dedicated "list security units" endpoint just
  // for this dropdown.
  useEffect(() => {
    api
      .get<InsightsSummary>('/insights/summary')
      .then((res) => setKnownUnits(res.unitActivity))
      .catch(() => setKnownUnits([]));
  }, []);

  const [deptComparisonRetry, setDeptComparisonRetry] = useState(0);

  useEffect(() => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ from, to, dayScope });
    if (team) params.set('team', team);
    if (unitId) params.set('unitId', unitId);
    if (movementType) params.set('movementType', movementType);
    api
      .get<InsightsSummary>(`/insights/summary?${params.toString()}`)
      .then((res) => {
        if (seq !== seqRef.current) return;
        setSummary(res);
      })
      .catch((err: any) => {
        if (seq !== seqRef.current) return;
        setSummary(null);
        setError(err?.message ?? 'Failed to load insights.');
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false);
      });
    // deptComparisonRetry: when the top Team filter is empty, Department
    // Comparison piggybacks on this same fetch (see below) rather than
    // firing its own — so its Retry button needs to re-trigger this effect
    // too, not just the independent-fetch one.
  }, [from, to, team, unitId, movementType, dayScope, deptComparisonRetry]);

  // Department Comparison's own fetch — deliberately omits the top Team
  // filter (Unit/Movement Type still apply). The top filter is a
  // single-select scoped to the whole page; applying it here would
  // collapse this cross-department chart down to the one selected team,
  // leaving nothing to compare. Direct user feedback, 2026-10-14.
  //
  // Only fetches independently when `team` is actually set — when it's
  // empty, this request would be byte-for-byte identical to the main
  // summary fetch above (same params, since `team` is the only thing this
  // endpoint omits), so it reuses that response instead of doubling this
  // page's connection footprint on every load. Insights' own concurrent
  // queries were found to be a meaningful contributor to real "Request
  // timed out" errors under the shared Supabase connection-pool cap — see
  // docs/roadmap.md's connection_limit item. Added 2026-10-14.
  const [deptComparisonFetched, setDeptComparisonFetched] = useState<TeamBreakdownRow[] | null>(null);
  const [deptComparisonFetchedError, setDeptComparisonFetchedError] = useState<string | null>(null);
  const [deptComparisonFetchedLoading, setDeptComparisonFetchedLoading] = useState(false);
  const deptComparisonSeqRef = useRef(0);
  useEffect(() => {
    if (!team) return; // piggybacks on the main summary fetch instead — see below
    const seq = ++deptComparisonSeqRef.current;
    setDeptComparisonFetchedLoading(true);
    const params = new URLSearchParams({ from, to, dayScope });
    if (unitId) params.set('unitId', unitId);
    if (movementType) params.set('movementType', movementType);
    api
      .get<InsightsSummary>(`/insights/summary?${params.toString()}`)
      .then((res) => {
        if (seq !== deptComparisonSeqRef.current) return;
        setDeptComparisonFetched(res.teamBreakdown);
        setDeptComparisonFetchedError(null);
      })
      .catch((err: any) => {
        if (seq !== deptComparisonSeqRef.current) return;
        // Don't silently blank the section on a transient failure — a timed-
        // out request here previously left this card permanently invisible
        // with no indication why. Found in the 2026-10-14 review.
        setDeptComparisonFetchedError(err?.message ?? 'Failed to load department data.');
      })
      .finally(() => {
        // Also fixes a related gap found in the same review: while this
        // fetch was in flight, the card showed neither data, an error, nor
        // a spinner — it just didn't exist on screen, indistinguishable
        // from "no departments" or a silent failure.
        if (seq === deptComparisonSeqRef.current) setDeptComparisonFetchedLoading(false);
      });
  }, [team, from, to, unitId, movementType, dayScope, deptComparisonRetry]);

  // The values the rest of the page actually reads — piggybacking on the
  // main summary's state when there's no independent fetch to report.
  const deptComparisonBreakdown = team ? deptComparisonFetched : (summary?.teamBreakdown ?? null);
  const deptComparisonError = team ? deptComparisonFetchedError : error;
  const deptComparisonLoading = team ? deptComparisonFetchedLoading : loading;

  useScrollRestoration('insights', !loading);

  useEffect(() => {
    saveSessionState(FILTERS_KEY, { from, to, team, unitId, movementType, dayScope });
  }, [from, to, team, unitId, movementType, dayScope]);

  useEffect(() => {
    saveSessionState(EMPLOYEE_KEY, selectedEmployee);
  }, [selectedEmployee]);

  useEffect(() => {
    saveSessionState(DEPT_COMPARISON_TEAMS_KEY, deptComparisonTeamFilter);
  }, [deptComparisonTeamFilter]);

  useEffect(() => {
    saveSessionState(DEPT_COMPARISON_EXPANDED_KEY, deptComparisonExpanded);
  }, [deptComparisonExpanded]);

  // Same modal-focus/Escape/Tab-trap pattern used by every other modal in
  // the app (Dashboard's summary drill-down, Employees' edit modal).
  useFocusTrap(!!drillDown, drillDownModalRef, drillDownCloseRef, closeDrillDown);

  // Same pattern, for the Daily Duration roster modal.
  useFocusTrap(dailyDurationOpen, dailyDurationModalRef, dailyDurationCloseRef, () => setDailyDurationOpen(false));

  // Same pattern, for the "How This Employee Compares" bucket click-through.
  useFocusTrap(!!distributionBucket, distributionBucketModalRef, distributionBucketCloseRef, () => setDistributionBucket(null));

  const fetchEmployeeResults = useCallback((q: string, teamFilter: string) => {
    const seq = ++employeeSearchSeqRef.current;
    const params = new URLSearchParams({ q });
    if (teamFilter) params.set('team', teamFilter);
    // search-all (not search) — HR should be able to pull up a former
    // employee's attendance history here too (e.g. for an exit review),
    // not just currently-active staff. Found missing in the 2026-10-27 audit.
    api
      .get<Employee[]>(`/employees/search-all?${params.toString()}`)
      .then((res) => {
        if (seq === employeeSearchSeqRef.current) setEmployeeResults(res);
      })
      .catch(() => {
        if (seq === employeeSearchSeqRef.current) setEmployeeResults([]);
      });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => fetchEmployeeResults(employeeQuery, team), employeeQuery.trim() ? 250 : 0);
    return () => clearTimeout(t);
  }, [employeeQuery, team, fetchEmployeeResults]);

  useEffect(() => {
    if (!employeeDropdownOpen) return;
    const closeIfOutside = (event: MouseEvent) => {
      if (employeeSearchRef.current && !employeeSearchRef.current.contains(event.target as Node)) {
        setEmployeeDropdownOpen(false);
      }
    };
    // A keyboard user could open this dropdown but had no way to close it
    // short of clicking elsewhere or tabbing through every result — every
    // custom dropdown in the app had the same gap. Found in the 2026-10-29
    // dropdown audit.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEmployeeDropdownOpen(false);
    };
    document.addEventListener('mousedown', closeIfOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeIfOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [employeeDropdownOpen]);

  useEffect(() => {
    if (!selectedEmployee) {
      setEmployeeDetail(null);
      return;
    }
    const seq = ++employeeDetailSeqRef.current;
    setEmployeeDetailLoading(true);
    setEmployeeDetailError(null);
    api
      .get<EmployeeDetail>(`/insights/employee-detail?employeeId=${selectedEmployee.id}&from=${from}&to=${to}&dayScope=${dayScope}`)
      .then((res) => {
        if (seq !== employeeDetailSeqRef.current) return;
        setEmployeeDetail(res);
      })
      .catch((err: any) => {
        if (seq !== employeeDetailSeqRef.current) return;
        setEmployeeDetail(null);
        setEmployeeDetailError(err?.message ?? 'Failed to load employee details.');
      })
      .finally(() => {
        if (seq === employeeDetailSeqRef.current) setEmployeeDetailLoading(false);
      });
  }, [selectedEmployee, from, to, dayScope]);

  // Only fetched once the roster modal is actually open — it was
  // previously fetched unconditionally even though the table sat far down
  // an already-long page, often never scrolled to. Direct user feedback,
  // 2026-10 (moved into a modal to shorten the page).
  useEffect(() => {
    if (!dailyDurationOpen) return;
    const seq = ++dailyDurationSeqRef.current;
    setDailyDurationLoading(true);
    setDailyDurationError(null);
    const params = new URLSearchParams({ date: dailyDurationDate, dayScope });
    if (team) params.set('team', team);
    if (unitId) params.set('unitId', unitId);
    api
      .get<{ date: string; rows: DailyDurationRow[]; noMovement: NoMovementRow[] }>(`/insights/daily-duration?${params.toString()}`)
      .then((res) => {
        if (seq !== dailyDurationSeqRef.current) return;
        setDailyDuration(res.rows);
        setDailyDurationNoMovement(res.noMovement);
      })
      .catch((err: any) => {
        if (seq !== dailyDurationSeqRef.current) return;
        setDailyDuration(null);
        setDailyDurationNoMovement(null);
        setDailyDurationError(err?.message ?? 'Failed to load daily duration.');
      })
      .finally(() => {
        if (seq === dailyDurationSeqRef.current) setDailyDurationLoading(false);
      });
  }, [dailyDurationOpen, dailyDurationDate, team, unitId, dayScope]);

  function openDrillDown(metric: DrillDownMetric, params: Record<string, string>, title: string) {
    const seq = ++drillDownSeqRef.current;
    setDrillDownSearch('');
    setDrillDownTeamFilter([]);
    setDrillDownSort(null);
    saveSessionState(DRILLDOWN_KEY, { metric, params, title } as DrillDownIntent);
    setDrillDown({ metric, title, date: params.date, params, rows: [], loading: true, error: null });
    const qp = new URLSearchParams({ metric, ...params });
    api
      .get<{ rows: any[]; truncated?: boolean }>(`/insights/drill-down?${qp.toString()}`)
      .then((res) => {
        if (seq !== drillDownSeqRef.current) return;
        setDrillDown({ metric, title, date: params.date, params, rows: res.rows, loading: false, error: null, truncated: res.truncated });
      })
      .catch((err: any) => {
        if (seq !== drillDownSeqRef.current) return;
        setDrillDown({ metric, title, date: params.date, params, rows: [], loading: false, error: err?.message ?? 'Failed to load details.' });
      });
  }

  function closeDrillDown() {
    setDrillDown(null);
    saveSessionState(DRILLDOWN_KEY, null);
  }

  // Shared by every "Export to Excel" button below — same binary-download
  // helper. A Set, not a single string: the three buttons (Team Breakdown,
  // Daily Duration, drill-down) have distinct, fixed keys and can each be
  // in flight independently — a single shared `exportingKey` string used to
  // mean starting a second export while the first was still running let
  // whichever one resolved first clear the flag for *both*, re-enabling a
  // button that was still genuinely exporting.
  const [exportingKeys, setExportingKeys] = useState<Set<string>>(new Set());
  async function downloadExcel(key: string, url: string) {
    setExportingKeys((prev) => new Set(prev).add(key));
    try {
      await downloadFile(url, `${key}-${todayIso()}.xlsx`);
    } catch {
      // Silent — this is a secondary action on a page whose primary data
      // is already visible on screen; a failed export isn't worth an
      // error banner, the button simply stops spinning.
    } finally {
      setExportingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  // Reopens whatever drill-down was open before navigating away to an
  // employee's day, so "back" returns to the exact same place.
  useEffect(() => {
    const saved = loadSessionState<DrillDownIntent | null>(DRILLDOWN_KEY, null);
    if (saved) openDrillDown(saved.metric, saved.params, saved.title);
  }, []);

  // movementType/dayScope are harmless to pass to every metric — the
  // backend ignores movementType for shortfall/missingExit (already
  // ENTRY+EXIT paired) and ignores dayScope for the raw-record metrics
  // (attendance/unit/hour/corrected), applying each only where it's
  // actually meaningful.
  const activeFilters = () => ({ ...(team ? { team } : {}), ...(unitId ? { unitId } : {}), ...(movementType ? { movementType } : {}), dayScope });

  // Merged: Daily Entries vs Exits + Unique Employees Entering by Day —
  // same x-axis (date), and showing the unique-headcount line alongside
  // the raw entry/exit bars actually adds insight (the gap between
  // "entries" and "unique employees" shows how many taps are repeat
  // taps from the same people). One chart instead of two near-duplicate
  // day-trend charts. Combined 2026-10, Insights graph-consolidation pass.
  const attendanceConfig: ChartConfiguration | null = summary && {
    type: 'bar',
    data: {
      labels: summary.attendanceTrend.map((d) => d.date),
      datasets: [
        { type: 'bar', label: 'Entries', data: summary.attendanceTrend.map((d) => d.entries), backgroundColor: BRAND },
        { type: 'bar', label: 'Exits', data: summary.attendanceTrend.map((d) => d.exits), backgroundColor: EXIT_RED },
        {
          type: 'line',
          label: 'Employees Present',
          data: summary.uniqueEmployeesByDay.map((d) => d.count),
          borderColor: BRAND_DARK,
          backgroundColor: BRAND_DARK,
          tension: 0.2,
        },
      ],
    },
    options: {
      ...baseLineOptions,
      // Single shared axis, not dual — Entries/Exits and Employees Present
      // are all just "count of something" in similar ranges here, so a
      // second scale added reading effort (which axis does the line belong
      // to?) without avoiding any real distortion. Dual axes are kept only
      // where the two measures are genuinely different units (e.g. hours
      // vs. day-counts in Avg Duration). Direct user feedback, 2026-10-13.
      ...clickableOptions((i) => {
        const date = summary.attendanceTrend[i].date;
        openDrillDown('attendance', { date, ...activeFilters() }, `Movements on ${date}`);
      }),
    },
  };

  // A raw "142 people tapped in" headcount is hard to read with no
  // baseline — 142 out of a 150-person roster is a very different story
  // than 142 out of 500. Normalizes the existing uniqueEmployeesByDay
  // count against the roster size (same denominator Team Breakdown's own
  // "Team Size" column already uses) instead of adding a new backend
  // trend endpoint. Added 2026-10, by request.
  const attendanceRateConfig: ChartConfiguration | null = summary && summary.totalRosterSize > 0 ? {
    type: 'line',
    data: {
      labels: summary.uniqueEmployeesByDay.map((d) => d.date),
      datasets: [
        {
          label: '% of roster present',
          data: summary.uniqueEmployeesByDay.map((d) => Math.round((d.count / summary.totalRosterSize) * 1000) / 10),
          borderColor: BRAND_DARK,
          backgroundColor: BRAND_DARK,
          tension: 0.2,
        },
      ],
    },
    options: {
      ...baseLineOptions,
      scales: {
        y: { beginAtZero: true, max: 100, ticks: { callback: (v: any) => `${v}%` }, title: axisTitle('% of roster') },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx: any) => {
              const count = summary.uniqueEmployeesByDay[ctx.dataIndex].count;
              const noMovement = summary.totalRosterSize - count;
              return `${count} present, ${noMovement} with no movement (${ctx.raw}%)`;
            },
          },
        },
      },
      // Opens the Daily Roster modal straight to "No Movement Recorded"
      // for that day — reuses the roster/movement diff already built for
      // the roster button instead of a new drill-down metric. Answers
      // "who" directly, not just "how many". Added 2026-10, by request.
      ...clickableOptions((i) => {
        const date = summary.uniqueEmployeesByDay[i].date;
        setDailyDurationDate(date);
        setDailyDurationQuery('');
        setDailyDurationTeamFilter([]);
        setDailyDurationSort(null);
        setDailyDurationView('noMovement');
        setDailyDurationOpen(true);
      }),
    },
  } : null;

  // Hides hours with zero movements across the whole range (typically
  // overnight, e.g. 00:00-06:00 for an office that's never staffed then) —
  // those bars added nothing but dead x-axis space and squeezed every real
  // bar narrower. Direct user feedback, 2026-10-13 ("show only where we
  // have data"). Index no longer equals hour-of-day once filtered, so the
  // click handler below looks up the real hour from the filtered row
  // instead of assuming index === hour.
  const visibleHours = summary ? summary.hourlyDistribution.filter((h) => h.entries > 0 || h.exits > 0) : [];
  const hourlyConfig: ChartConfiguration | null = summary && {
    type: 'bar',
    data: {
      labels: visibleHours.map((h) => `${String(h.hour).padStart(2, '0')}:00`),
      datasets: [
        { label: 'Entries', data: visibleHours.map((h) => h.entries), backgroundColor: BRAND },
        { label: 'Exits', data: visibleHours.map((h) => h.exits), backgroundColor: EXIT_RED },
      ],
    },
    options: {
      ...baseLineOptions,
      // Logarithmic, not linear — a single-digit quiet-hour bar next to a
      // 1000+ peak-hour bar was invisible on a linear scale. Trade-off:
      // bar heights no longer scale proportionally to their value at a
      // glance; the real count is still in the tooltip/axis ticks. Direct
      // user feedback, 2026-10-13.
      scales: { y: { type: 'logarithmic' as const, title: axisTitle('Movements (log scale)') } },
      ...clickableOptions((i) => {
        const hour = visibleHours[i].hour;
        const hourLabel = `${String(hour).padStart(2, '0')}:00`;
        openDrillDown('hour', { hour: String(hour), from, to, ...activeFilters() }, `Movements at ${hourLabel} (${from} to ${to})`);
      }),
    },
  };

  // Merged: Average Daily Duration Trend + Short-Duration Days Trend +
  // Long-Duration Days Trend — same x-axis, and directly related (avg
  // duration dipping is exactly when short-duration days spike, and vice
  // versa for long-duration days), so a single combo reads as one story.
  // The long-duration trend was already computed server-side
  // (hoursLongDuration.trend) but had no chart — only a KPI total — unlike
  // short-duration, which had both. Added 2026-10 UI pass.
  const avgDurationTrendConfig: ChartConfiguration | null = summary && {
    type: 'bar',
    data: {
      labels: summary.avgDurationTrend.map((d) => d.date),
      datasets: [
        {
          type: 'bar',
          label: `Short-duration (under ${summary.shiftReference.expectedHours}h)`,
          data: summary.hoursShortfall.trend.map((d) => d.shortfallCount),
          backgroundColor: EXIT_RED,
          yAxisID: 'y1',
        },
        {
          type: 'bar',
          label: `Long-duration (over ${summary.hoursLongDuration.threshold}h)`,
          data: summary.hoursLongDuration.trend.map((d) => d.longDurationCount),
          backgroundColor: AMBER,
          yAxisID: 'y1',
        },
        {
          type: 'line',
          label: 'Avg duration (hrs)',
          data: summary.avgDurationTrend.map((d) => d.avgHours),
          borderColor: BRAND_DARK,
          backgroundColor: BRAND_DARK,
          tension: 0.2,
          spanGaps: true,
        },
      ],
    },
    options: {
      ...baseLineOptions,
      scales: {
        // Ticks/title colored to match the line they belong to (BRAND_DARK,
        // same as "Avg duration (hrs)") so the axis can be traced to its
        // series by color, not just position — the bars' axis (y1) can't
        // get the same treatment since two different-colored bar series
        // share it, so it stays neutral instead of picking one arbitrarily.
        // Direct user feedback, 2026-10-13.
        y: { beginAtZero: true, ticks: { precision: 0, color: BRAND_DARK }, title: axisTitle('Hours', BRAND_DARK) },
        // "Employees", not "Days" — each bar is already one specific date
        // (the x-axis), so its height is a headcount of who was short/long
        // that day, not a count of days. Direct user feedback, 2026-10-13.
        y1: { position: 'right' as const, beginAtZero: true, ticks: { precision: 0 }, grid: { display: false }, title: axisTitle('Employees') },
      },
      plugins: {
        ...baseLineOptions.plugins,
        tooltip: {
          callbacks: {
            // Repeats the unit on every line of the tooltip — without it,
            // "9.1" next to "26" reads as directly comparable numbers
            // instead of two different units sharing the same popup.
            label: (ctx: any) => (ctx.dataset.type === 'line' ? `${ctx.dataset.label}: ${ctx.raw}h` : `${ctx.dataset.label}: ${ctx.raw} employees`),
            // States the formula on hover, not just in the hint text above
            // — only on the bars (short/long-duration), not the avg-hours
            // line, since that one's already just "the average" with no
            // threshold to explain. Direct user feedback, 2026-10-13.
            footer: (items: any[]) =>
              items.some((i) => i.dataset.type === 'bar')
                ? `= last exit − first entry that day, under ${summary.shiftReference.expectedHours}h or ${summary.hoursLongDuration.threshold}h+`
                : '',
          },
        },
      },
      onClick: (_evt: any, elements: any[]) => {
        if (elements.length === 0) return;
        const el = elements[0];
        if (el.datasetIndex !== 0 && el.datasetIndex !== 1) return;
        const date = summary.avgDurationTrend[el.index].date;
        const metric = el.datasetIndex === 1 ? 'longDuration' : 'shortfall';
        const threshold = el.datasetIndex === 1 ? summary.hoursLongDuration.threshold : summary.shiftReference.expectedHours;
        const verb = el.datasetIndex === 1 ? 'Over' : 'Under';
        openDrillDown(metric, { date, ...activeFilters() }, `${verb} ${threshold}h on ${date}`);
      },
      onHover: (evt: any, elements: any[]) => {
        if (evt.native?.target) (evt.native.target as HTMLElement).style.cursor = elements.length ? 'pointer' : 'default';
      },
    },
  };

  // Stacks every department against every other, for whatever date range
  // is selected above (the existing This Month/Attendance Month presets
  // already cover "pick a month" — no separate month picker needed). Median
  // (not average) so one outlier day doesn't skew the comparison, plus
  // both tails — short-duration and overtime — not just hours. Added
  // 2026-10-13, by request.
  // Client-side only — deptComparisonBreakdown already has every team's
  // data computed, so narrowing/sorting which ones render doesn't need a
  // new request. Sorted by overtime % descending, not alphabetically — the
  // point of this chart is "who needs attention," which means the worst
  // offenders belong at the top, not buried mid-alphabet. Direct user
  // feedback, 2026-10-13.
  const departmentComparisonFiltered = deptComparisonBreakdown
    ? deptComparisonTeamFilter.length === 0
      ? deptComparisonBreakdown
      : deptComparisonBreakdown.filter((t) => deptComparisonTeamFilter.includes(t.team))
    : [];
  const departmentComparisonTeams = departmentComparisonFiltered.map((t) => ({
    ...t,
    shortfallRate: t.daysWithHoursTracked > 0 ? t.shortfallDays / t.daysWithHoursTracked : 0,
    overtimeRate: t.daysWithHoursTracked > 0 ? t.longDurationDays / t.daysWithHoursTracked : 0,
  }));
  // Median Duration gets its own sort, independent of the overtime-based
  // sort above — ordering it by overtime % (a different metric) made its
  // own order look arbitrary relative to its own bars. Direction is
  // user-controlled (see medianSortDir toggle below). Direct user
  // feedback, 2026-10-13.
  const departmentComparisonMedianTeams = [...departmentComparisonFiltered].sort((a, b) =>
    medianSortDir === 'desc' ? (b.medianHours ?? 0) - (a.medianHours ?? 0) : (a.medianHours ?? 0) - (b.medianHours ?? 0),
  );
  // Each metric is its own fully independent chart — no two metrics are
  // clubbed into one, so none of them need a shared sort order or a second
  // axis. Direct user feedback, 2026-10-13. All 3 always render (no
  // show/hide toggle) — once split into separate charts there's no
  // clutter-by-combination left to decline into. Direct user feedback,
  // 2026-10-14.
  const departmentComparisonMedianLabels = departmentComparisonMedianTeams.map((t) => `${t.team} (${t.employeeCount})`);
  const departmentComparisonClick = clickableOptions((i: number) => {
    const team = departmentComparisonMedianTeams[i].team;
    openDrillDown('team', { from, to, ...activeFilters(), team }, `${team} team`);
  });
  const departmentComparisonHoursConfig: ChartConfiguration | null =
    departmentComparisonMedianTeams.length > 0
      ? {
          type: 'bar',
          data: {
            labels: departmentComparisonMedianLabels,
            datasets: [
              { type: 'bar', label: 'Median Duration (hrs)', data: departmentComparisonMedianTeams.map((t) => t.medianHours ?? 0), backgroundColor: BRAND_DARK },
            ],
          },
          options: {
            ...baseLineOptions,
            // Teams on the x-axis, by request — thinner bars/tighter
            // category spacing (not a wider scrollable chart) so all
            // departments still fit without scrolling. 2026-10-13. Narrowed
            // further (0.9/0.8 → 0.8/0.7 → 0.6/0.5) and the team-name labels
            // bolded/enlarged (10px → 11px bold) for easier reading, since
            // the rotated labels aren't bar-width-bound. 2026-10-14.
            datasets: { bar: { barPercentage: 0.6, categoryPercentage: 0.5 } },
            scales: {
              x: { ticks: { maxRotation: 90, minRotation: 90, autoSkip: false, font: { size: 11, weight: 'bold' } } },
              y: { beginAtZero: true, ticks: { precision: 0 }, title: axisTitle('Hours') },
            },
            ...departmentComparisonClick,
          },
        }
      : null;

  // Shared by the Short-Duration and Overtime charts below — same shape,
  // same axis, same tooltip/click pattern, just a different field/metric
  // each time. Not shared with Median, which is hours (a different unit
  // and axis), not a %.
  function buildPercentConfig(
    sortedTeams: typeof departmentComparisonTeams,
    opts: { label: string; color: string; rateField: 'shortfallRate' | 'overtimeRate'; countField: 'shortfallDays' | 'longDurationDays'; metric: 'shortfall' | 'longDuration'; verb: string; threshold: number },
  ): ChartConfiguration | null {
    if (!summary || sortedTeams.length === 0) return null;
    const labels = sortedTeams.map((t) => `${t.team} (${t.employeeCount})`);
    return {
      type: 'bar',
      data: {
        labels,
        datasets: [{ type: 'bar', label: opts.label, data: sortedTeams.map((t) => Math.round(t[opts.rateField] * 1000) / 10), backgroundColor: opts.color }],
      },
      options: {
        ...baseLineOptions,
        datasets: { bar: { barPercentage: 0.6, categoryPercentage: 0.5 } },
        scales: {
          x: { ticks: { maxRotation: 90, minRotation: 90, autoSkip: false, font: { size: 11, weight: 'bold' } } },
          y: { beginAtZero: true, max: 100, ticks: { callback: (v: any) => `${v}%` }, title: axisTitle('% of tracked days') },
        },
        plugins: {
          ...baseLineOptions.plugins,
          tooltip: {
            callbacks: {
              // Count alongside the %, not just the % — "56.6%" alone
              // doesn't say out of how many tracked days. Direct user
              // feedback, 2026-10-13.
              label: (ctx: any) => {
                const t = sortedTeams[ctx.dataIndex];
                return `${ctx.dataset.label}: ${ctx.raw}% (${t[opts.countField]} of ${t.daysWithHoursTracked} tracked days)`;
              },
              footer: () => `${opts.label.split(' (')[0]} day = (last exit − first entry) ${opts.verb} ${opts.threshold}h`,
            },
          },
        },
        onClick: (_evt: any, elements: any[]) => {
          if (elements.length === 0) return;
          const team = sortedTeams[elements[0].index].team;
          // Routes to the same shortfall/longDuration drill-down the Avg
          // Duration chart and Duration Exceptions cards use — only that
          // team's short/over records, not its whole roster. Direct user
          // feedback, 2026-10-13.
          openDrillDown(opts.metric, { from, to, ...activeFilters(), team }, `${opts.verb === 'under' ? 'Under' : 'Over'} ${opts.threshold}h — ${team} (${from} to ${to})`);
        },
        onHover: (evt: any, elements: any[]) => {
          if (evt.native?.target) (evt.native.target as HTMLElement).style.cursor = elements.length ? 'pointer' : 'default';
        },
      },
    };
  }

  const departmentComparisonShortfallTeams = [...departmentComparisonTeams].sort((a, b) =>
    shortfallSortDir === 'desc' ? b.shortfallRate - a.shortfallRate : a.shortfallRate - b.shortfallRate,
  );
  const departmentComparisonOvertimeTeams = [...departmentComparisonTeams].sort((a, b) =>
    overtimeSortDir === 'desc' ? b.overtimeRate - a.overtimeRate : a.overtimeRate - b.overtimeRate,
  );
  const departmentComparisonShortfallConfig: ChartConfiguration | null =
    summary
      ? buildPercentConfig(departmentComparisonShortfallTeams, {
          label: `Short-Duration (Under ${summary.shiftReference.expectedHours}h) %`,
          color: EXIT_RED,
          rateField: 'shortfallRate',
          countField: 'shortfallDays',
          metric: 'shortfall',
          verb: 'under',
          threshold: summary.shiftReference.expectedHours,
        })
      : null;
  const departmentComparisonOvertimeConfig: ChartConfiguration | null =
    summary
      ? buildPercentConfig(departmentComparisonOvertimeTeams, {
          label: `Overtime (Over ${summary.hoursLongDuration.threshold}h) %`,
          color: AMBER,
          rateField: 'overtimeRate',
          countField: 'longDurationDays',
          metric: 'longDuration',
          verb: 'over',
          threshold: summary.hoursLongDuration.threshold,
        })
      : null;

  // Removed the "Daily Duration Distribution" histogram (2026-10) — a
  // whole-range, whole-org bucket chart with no drill-through or team
  // segmentation. The Short/Long-Duration cards and Team Breakdown table
  // already cover the actionable parts of this with real click-through.
  // Direct user feedback.

  // Merged: Missing Exits Trend + the missing-entries count (previously
  // only a KPI card with no day-by-day view) — same data-quality
  // category, same x-axis, now one "Missing Movements" chart instead of
  // needing two.
  const missingExitsConfig: ChartConfiguration | null = summary && {
    type: 'bar',
    data: {
      labels: summary.missingExits.trend.map((d) => d.date),
      datasets: [
        { label: 'Missing exits', data: summary.missingExits.trend.map((d) => d.count), backgroundColor: AMBER },
        { label: 'Missing entries', data: summary.missingExits.trend.map((d) => d.missingEntryCount), backgroundColor: EXIT_RED },
      ],
    },
    options: {
      ...baseLineOptions,
      // "Employees", not "Flagged Days" — each bar is already one specific
      // date (the x-axis), so its height is a headcount of who was missing
      // an exit/entry that day, not a count of days. Same reasoning as Avg
      // Duration's bars. Direct user feedback, 2026-10-13.
      scales: { y: { ...baseLineOptions.scales.y, title: axisTitle('Employees') } },
      onClick: (_evt: any, elements: any[]) => {
        if (elements.length === 0) return;
        const el = elements[0];
        const date = summary.missingExits.trend[el.index].date;
        const metric = el.datasetIndex === 1 ? 'missingEntry' : 'missingExit';
        const label = el.datasetIndex === 1 ? 'Missing entries' : 'Missing exits';
        openDrillDown(metric, { date, ...activeFilters() }, `${label} on ${date}`);
      },
      onHover: (evt: any, elements: any[]) => {
        if (evt.native?.target) (evt.native.target as HTMLElement).style.cursor = elements.length ? 'pointer' : 'default';
      },
    },
  };

  const unitActivityConfig: ChartConfiguration | null = summary && {
    type: 'bar',
    data: {
      labels: summary.unitActivity.map((u) => u.unitName),
      datasets: [
        { label: 'Entries', data: summary.unitActivity.map((u) => u.entries), backgroundColor: BRAND },
        { label: 'Exits', data: summary.unitActivity.map((u) => u.exits), backgroundColor: EXIT_RED },
      ],
    },
    options: {
      ...baseLineOptions,
      scales: { y: { ...baseLineOptions.scales.y, title: axisTitle('Movements') } },
      ...clickableOptions((i) => {
        const u = summary.unitActivity[i];
        openDrillDown('unit', { unitId: String(u.unitId), from, to, ...(team ? { team } : {}), ...(movementType ? { movementType } : {}) }, `${u.unitName} movements`);
      }),
    },
  };

  // Removed the separate "Team Breakdown — Average Duration" bar chart
  // (2026-10) — the Detail table below is sortable by any column
  // (including Avg Duration) and shows team size, days present, and
  // short-duration % alongside it, which the chart alone couldn't. A
  // 24-category horizontal bar chart didn't add anything a sorted table
  // doesn't already do better. Direct user feedback.

  // Removed a "Shortfall Rate by Team" chart added then cut the same day
  // (2026-10) — it duplicated the Detail table's own sortable
  // Short-Duration column, and its click handler was one of two different
  // things firing from a single team click (this chart + the Detail table
  // row), which was confusing. Direct user feedback.

  // Removed "Weekday-wise Movement Pattern" (2026-10) — not clickable,
  // whole-org blended, and mostly just confirmed "weekends are quiet,"
  // which this Mon-Fri office already knows. Any genuine weekday pattern
  // worth acting on still needs a path to "who/which team," which this
  // chart never had. Direct user feedback.

  // Merged: Daily Duration + Daily Entry/Exit Counts — same employee, same
  // x-axis (date), so a dual-axis combo tells the whole daily story (how
  // long they were in, and how many taps it took) in one chart instead of
  // two the reader has to mentally line up by date.
  const employeeHoursConfig: ChartConfiguration | null = employeeDetail && {
    type: 'line',
    data: {
      labels: employeeDetail.dailyCounts.map((d) => d.date),
      datasets: [
        {
          type: 'line',
          label: 'Duration that day',
          data: employeeDetail.dailyCounts.map((d) => employeeDetail.dailyHours.find((h) => h.date === d.date)?.hours ?? null),
          borderColor: BRAND_DARK,
          backgroundColor: BRAND_DARK,
          tension: 0.2,
          spanGaps: true,
        },
        {
          type: 'line',
          label: `${summary?.shiftReference.expectedHours ?? 9}h reference`,
          data: employeeDetail.dailyCounts.map(() => summary?.shiftReference.expectedHours ?? 9),
          borderColor: MUTED,
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      ...baseLineOptions,
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 }, title: axisTitle('Hours') },
      },
      ...clickableOptions((i) => {
        if (!selectedEmployee) return;
        const date = employeeDetail!.dailyCounts[i].date;
        navigate(`/employee-details?employeeId=${selectedEmployee.id}&date=${date}`);
      }),
    },
  };

  // Where this one employee stands against everyone else — every active
  // employee's own avg duration (same range), bucketed to the nearest
  // QUARTER hour and counted into a histogram. This employee's bucket is
  // highlighted. Clicking a point lists who's in that bucket. Added
  // 2026-10-13/14, by request. Went whole-hour -> half-hour -> quarter-hour
  // (2026-10-15, by request, twice) — each step was rounding people who
  // were actually apart into the same visual spot. Compares against
  // employeeDurationBucket (computed server-side with the exact same
  // rounding as the histogram itself), not a re-round of the 1-decimal
  // employeeAvgHours display value — re-rounding that on the frontend can
  // land on a different quarter-hour bucket than the real one right at a
  // rounding boundary.
  const isEmployeeBucket = (hours: number) => employeeDetail!.employeeDurationBucket === hours;
  const employeeDistributionConfig: ChartConfiguration | null =
    employeeDetail && employeeDetail.durationDistribution.length > 0
      ? {
          type: 'line',
          data: {
            labels: employeeDetail.durationDistribution.map((d) => `${d.hours}h`),
            datasets: [
              {
                type: 'line',
                label: 'Employees',
                data: employeeDetail.durationDistribution.map((d) => d.count),
                borderColor: MUTED,
                backgroundColor: MUTED,
                tension: 0.3,
                // The line itself stays one neutral color (it's the whole
                // population's shape) — only the point at this employee's
                // own bucket is highlighted, larger and in brand color, so
                // it reads as "you are here" on the curve. Direct user
                // feedback, 2026-10-13.
                pointBackgroundColor: employeeDetail.durationDistribution.map((d) =>
                  isEmployeeBucket(d.hours) ? BRAND_DARK : MUTED,
                ),
                pointBorderColor: employeeDetail.durationDistribution.map((d) =>
                  isEmployeeBucket(d.hours) ? BRAND_DARK : MUTED,
                ),
                pointRadius: employeeDetail.durationDistribution.map((d) =>
                  isEmployeeBucket(d.hours) ? 7 : 3,
                ),
              },
            ],
          },
          options: {
            ...baseLineOptions,
            plugins: {
              ...baseLineOptions.plugins,
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: (ctx: any) => {
                    const d = employeeDetail!.durationDistribution[ctx.dataIndex];
                    const isSelf = isEmployeeBucket(d.hours);
                    return `${d.count} employee${d.count === 1 ? '' : 's'} averaging ~${d.hours}h${isSelf ? ' (includes this employee)' : ''}`;
                  },
                },
              },
            },
            scales: {
              x: { title: axisTitle('Avg Duration (hrs)') },
              y: { beginAtZero: true, ticks: { precision: 0 }, title: axisTitle('Employees') },
            },
            onClick: (_evt: any, elements: any[]) => {
              if (elements.length === 0) return;
              const d = employeeDetail!.durationDistribution[elements[0].index];
              if (d.count > 0) setDistributionBucket({ hours: d.hours, employees: d.employees });
            },
            onHover: (evt: any, elements: any[]) => {
              if (evt.native?.target) (evt.native.target as HTMLElement).style.cursor = elements.length ? 'pointer' : 'default';
            },
          },
        }
      : null;

  // Blocks the whole screen (no clicks reach anything underneath) while any
  // filter-driven fetch is in flight — a filter change used to let you keep
  // clicking around while the page was still catching up to the new
  // filters, which could open a drill-down or select an employee against
  // data that was about to be replaced. Direct user feedback, 2026-10-14.
  const pageBlocked = loading || deptComparisonLoading || employeeDetailLoading || allTimeLoading;
  // Badges the "Filters" toggle so it's clear at a glance whether anything
  // non-default is active without having to open the row to check.
  // Includes `selectedEmployee` now that Clear resets it too (see Clear's
  // onClick below) — it sits in the same filter row, so it should count
  // toward "how many of these are active" the same way the other four do.
  const activeFilterCount = [team !== '', unitId !== '', movementType !== '', dayScope !== 'weekdays', selectedEmployee !== null].filter(Boolean).length;

  return (
    <div className="page-wide insights-table-scope">
      <AdminNav />

      {pageBlocked && (
        <div
          role="status"
          aria-live="polite"
          aria-label="Loading"
          style={{ position: 'fixed', inset: 0, background: 'rgba(255,255,255,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span className="spinner dark" style={{ width: 40, height: 40, borderWidth: 4, margin: 0 }} />
        </div>
      )}

      <div className="page-heading">
        <IconBarChart />
        Insights
        {loading && summary && <span className="spinner dark" style={{ marginLeft: 10 }} aria-label="Refreshing…" />}
      </div>

      <div className="filters-bar" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        {/* width: 100% — without it, this nested flex row (a flex ITEM of
            the column-direction .filters-bar above) never gets a resolved
            width before its own flex-wrap line-breaking runs. That makes
            Chromium miscompute an extra empty wrapped line, inflating the
            row's auto height well past its visible content (a real,
            reproduced bug, not just a style nit). Found 2026-10-19. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', width: '100%' }}>
        {/* The pill set stays visually grouped as one unit (its own
            flex-wrap sub-row) instead of individual pills interleaving with
            From/To when the row wraps on a narrower screen. */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { label: 'Today', from: todayIso(), to: todayIso() },
            { label: 'Yesterday', from: isoDaysAgo(1), to: isoDaysAgo(1) },
            { label: 'This Week', from: startOfWeekIso(), to: todayIso() },
            { label: 'This Month', from: startOfMonthIso(), to: todayIso() },
            // 'Last 30 Days' removed 2026-10-16, by request — This Month and
            // All Time already cover that range, and it was the one preset
            // visually indistinguishable from This Month at a glance.
          ].map((preset) => (
            <button
              key={preset.label}
              type="button"
              className={`quick-date-btn ${from === preset.from && to === preset.to ? 'active' : ''}`}
              onClick={() => {
                setFrom(preset.from);
                setTo(preset.to);
              }}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            className={`quick-date-btn ${earliestMovementDate && from === earliestMovementDate && to === todayIso() ? 'active' : ''}`}
            disabled={allTimeLoading}
            onClick={async () => {
              // Fetched once and cached, not a guessed/hardcoded start date
              // — the real earliest recorded movement, so the From field
              // shows something meaningful instead of an arbitrary filler
              // date. Found 2026-10-13, by request.
              let earliest = earliestMovementDate;
              if (!earliest) {
                setAllTimeLoading(true);
                try {
                  const res = await api.get<{ date: string | null }>('/insights/earliest-movement');
                  earliest = res.date ?? todayIso();
                  setEarliestMovementDate(earliest);
                } finally {
                  setAllTimeLoading(false);
                }
              }
              setFrom(earliest);
              setTo(todayIso());
            }}
          >
            {allTimeLoading && <span className="spinner" style={{ marginRight: 6 }} />}
            All Time
          </button>
          {(() => {
            const attendanceRange = attendanceMonthRange(attendanceMonthOffset);
            const isAttendanceMonthActive = from === attendanceRange.from && to === attendanceRange.to;
            const applyAttendanceMonth = (offset: number) => {
              const r = attendanceMonthRange(offset);
              setAttendanceMonthOffset(offset);
              setFrom(r.from);
              setTo(r.to);
            };
            return (
              <>
                <button
                  type="button"
                  className={`quick-date-btn ${isAttendanceMonthActive ? 'active' : ''}`}
                  onClick={() => applyAttendanceMonth(isAttendanceMonthActive ? attendanceMonthOffset : 0)}
                  title={isAttendanceMonthActive ? attendanceRange.label : undefined}
                >
                  {/* The resolved range isn't repeated here — it's already
                      shown in the From/To fields right below once active,
                      so printing it again just made this one pill balloon
                      to ~3x the width of every sibling pill for no benefit.
                      Found in the 2026-10 UI-sync pass. */}
                  Attendance Month
                </button>
                {isAttendanceMonthActive && (
                  <>
                    <button
                      type="button"
                      className="quick-date-btn"
                      aria-label="Previous attendance cycle"
                      onClick={() => applyAttendanceMonth(attendanceMonthOffset - 1)}
                    >
                      <IconChevronRight style={{ transform: 'rotate(180deg)', width: 14, height: 14 }} />
                    </button>
                    <button
                      type="button"
                      className="quick-date-btn"
                      aria-label="Next attendance cycle"
                      onClick={() => applyAttendanceMonth(attendanceMonthOffset + 1)}
                    >
                      <IconChevronRight style={{ width: 14, height: 14 }} />
                    </button>
                  </>
                )}
              </>
            );
          })()}
        </div>
        {/* No "From"/"To" text labels — the pills beside it are
            self-explanatory as a date range, and the labels made this row
            taller than (and visually disjointed from) the pills next to it.
            aria-label keeps it accessible without the visible text. Matches
            Option C mockup, direct user feedback, 2026-10-19. */}
        <input
          type="date"
          aria-label="From date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          max={to}
          style={{ flex: '0 1 150px', padding: '12px 14px', borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--border)', background: 'var(--card-bg)', fontSize: 16 }}
        />
        <span style={{ color: 'var(--text-muted)' }}>–</span>
        <input
          type="date"
          aria-label="To date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          min={from}
          max={todayIso()}
          style={{ flex: '0 1 150px', padding: '12px 14px', borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--border)', background: 'var(--card-bg)', fontSize: 16 }}
        />
        <div style={{ flex: '1 1 auto' }} />
        {/* Team/Unit/Movement/Days (and the Employee lookup below) collapse
            behind this toggle — closed by default, so the card's at-rest
            height is just this date-range row. Badged with a live count so
            it's clear at a glance whether anything non-default is active
            without opening it to check. Expands a second row inside this
            same card (not a floating popover) when open, so it reads as one
            connected bar that grew by a row rather than a popup sitting on
            top of the page. Added 2026-10-16, by request. */}
        <button
          type="button"
          className={`table-action-btn filters-toggle-btn ${filtersOpen ? 'open' : ''}`}
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
          style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto' }}
        >
          <IconFilter style={{ width: 14, height: 14 }} />
          Filters
          {activeFilterCount > 0 && <span className="filter-count-badge">{activeFilterCount}</span>}
          <IconChevronRight
            style={{ width: 12, height: 12, transform: filtersOpen ? 'rotate(-90deg)' : 'rotate(90deg)', transition: 'transform 0.3s var(--ease-spring)' }}
          />
        </button>
        {/* Paired with Filters above rather than given its own card — both
            are "jump to something specific" lookup tools, unlike every
            other field here which actually filters the charts below. Was a
            full section-card; collapsed into this row instead, which keeps
            the same prominence/click-pattern without the fixed card
            overhead. Direct user feedback, 2026-10. */}
        <button
          type="button"
          className="table-action-btn"
          title="Every employee's movements for one specific day, independent of the date range above."
          style={{ flex: '0 0 auto' }}
          onClick={() => {
            setDailyDurationQuery('');
            setDailyDurationTeamFilter([]);
            setDailyDurationSort(null);
            setDailyDurationView('present');
            setDailyDurationOpen(true);
          }}
        >
          View Daily Roster
        </button>
        </div>

        {filtersOpen && (
        <div className="filters-panel-expand" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', width: '100%' }}>
        <div className="field" style={{ position: 'relative', flex: '1.4 1 200px' }} ref={employeeSearchRef}>
          <label>
            Employee
            {selectedEmployee ? (
              <div className="filter-chip">
                <span>
                  {selectedEmployee.employeeName} ({selectedEmployee.employeeCode})
                  {!selectedEmployee.isActive ? ' · inactive' : ''}
                </span>
                <button type="button" onClick={() => setSelectedEmployee(null)} aria-label="Clear employee selection">
                  <IconX />
                </button>
              </div>
            ) : (
              // Plain .field input sizing (12px/16px), not .search-box (the
              // larger hero-search style meant for a page's one big search)
              // — this field sits in a row of compact filters, and the
              // bigger padding/font made it visibly taller than Team/Unit/
              // Movement beside it. Same pattern already used for this icon
              // on Dashboard/Employees. Fixed 2026-10-13, by request.
              <div style={{ position: 'relative' }}>
                <IconSearch className="search-icon" style={{ left: 12, width: 16, height: 16 }} />
                <input
                  aria-label="Search for an employee by name, code, email, or car number"
                  placeholder="Search for an employee…"
                  value={employeeQuery}
                  onChange={(e) => setEmployeeQuery(e.target.value)}
                  onFocus={() => {
                    setEmployeeDropdownOpen(true);
                    fetchEmployeeResults(employeeQuery, team);
                  }}
                  style={{ paddingLeft: 36, paddingRight: employeeQuery ? 36 : undefined }}
                />
                {employeeQuery && (
                  <button type="button" className="search-clear-btn" onClick={() => setEmployeeQuery('')} aria-label="Clear search">
                    <IconX />
                  </button>
                )}
                {employeeDropdownOpen &&
                  (() => {
                    // Team filter is applied server-side (/employees/search?team=),
                    // before its 10-result cap — client-side filtering of an
                    // already-capped result list could hide real team members
                    // outside the first 10 active employees alphabetically.
                    // Fixed 2026-10-13 after the Team filter was found hiding
                    // real team members from this dropdown.
                    if (employeeResults.length === 0) {
                      return team ? (
                        <div className="search-results">
                          <div style={{ padding: '12px 16px', fontSize: 14, color: 'var(--text-muted)' }}>No matches in {team}</div>
                        </div>
                      ) : null;
                    }
                    return (
                      <div className="search-results">
                        {employeeResults.map((emp) => (
                          <button
                            key={emp.id}
                            onClick={() => {
                              setSelectedEmployee(emp);
                              setEmployeeQuery('');
                              setEmployeeResults([]);
                              setEmployeeDropdownOpen(false);
                            }}
                          >
                            <span className="result-text">
                              <div className="result-name">
                                {emp.employeeName}
                                {!emp.isActive && <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}> · inactive</span>}
                              </div>
                              <div className="result-meta">
                                {emp.employeeCode}
                                {emp.team ? ` · ${emp.team}` : ''}
                              </div>
                            </span>
                          </button>
                        ))}
                      </div>
                    );
                  })()}
              </div>
            )}
          </label>
        </div>
        <div className="field" style={{ flex: '1 1 150px' }}>
          <label>
            Team
            <SingleSelect
              options={[{ value: '', label: 'All teams' }, ...teams.map((t) => ({ value: t, label: t }))]}
              value={team}
              onChange={setTeam}
              ariaLabel="Filter by team"
            />
          </label>
        </div>
        <div className="field" style={{ flex: '1 1 150px' }}>
          <label>
            Unit
            <SingleSelect
              options={[{ value: '', label: 'All units' }, ...knownUnits.map((u) => ({ value: String(u.unitId), label: u.unitName }))]}
              value={unitId}
              onChange={setUnitId}
              ariaLabel="Filter by unit"
            />
          </label>
        </div>
        <div className="field" style={{ flex: '1 1 150px' }}>
          <label>
            Movement
            <SingleSelect
              options={[
                { value: '', label: 'All' },
                { value: 'ENTRY', label: 'ENTRY' },
                { value: 'EXIT', label: 'EXIT' },
              ]}
              value={movementType}
              onChange={(v) => setMovementType(v as '' | 'ENTRY' | 'EXIT')}
              ariaLabel="Filter by movement type"
            />
          </label>
        </div>
        <div className="field" style={{ flex: '1 1 150px' }}>
          <label>
            Days
            <SingleSelect options={DAY_SCOPE_OPTIONS} value={dayScope} onChange={(v) => setDayScope(v as DayScope)} ariaLabel="Filter by day scope" />
          </label>
        </div>
        <button
          type="button"
          className="table-action-btn"
          // .table-action-btn's own padding/min-height (36px, sized for the
          // toolbar row above) is shorter than the 47px .field inputs/
          // selects this button sits flush against here — same mismatch as
          // the quick-date pills. Padding-only match (not font-size) so
          // "Clear" stays the same text size as its Filters/View Daily
          // Roster siblings. Found 2026-10-19.
          style={{ color: 'var(--text-muted)', flex: '0 0 auto', padding: '14.5px 14px' }}
          onClick={() => {
            setTeam('');
            setUnitId('');
            setMovementType('');
            setDayScope('weekdays');
            // Employee sits in this same filter row (with its own separate
            // X on the chip) — Clear used to deliberately skip it, which
            // read as "Clear does nothing" whenever Team/Unit/Movement/Days
            // already happened to be at their defaults (e.g. right after
            // drilling into an employee from Team Breakdown, which never
            // touches those four). Now resets it too, matching what it
            // visually looks grouped with. Found in the 2026-10-21 UI check.
            setSelectedEmployee(null);
          }}
        >
          Clear
        </button>
        </div>
        )}
      </div>

      {/* Right after the filters-bar, next to the Employee search that
          actually drives it — picking an employee there should surface the
          result immediately, not after scrolling past every other section.
          Previously placed last (broad-to-narrow ordering); moved back up
          per direct user feedback, 2026-10. */}
      <div id="per-employee-detail" className="section-card heavy-individual" style={{ marginBottom: 16 }}>
        <h3>
          Per-Employee Detail{selectedEmployee ? ` — ${selectedEmployee.employeeName}` : ''}
          <span className="section-eyebrow-badge">INDIVIDUAL</span>
        </h3>
        <ChartHint>
          One employee's trend for the date range above — arrival/departure time and on-premises duration per day. Everything below this card covers
          everyone, not just this employee.
        </ChartHint>
        {!selectedEmployee && !employeeDetailLoading && (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>No employee selected yet.</p>
        )}

        {employeeDetailLoading && (
          <div style={{ marginTop: 16 }}>
            <div className="summary-cards summary-cards-4" style={{ marginBottom: 16 }}>
              {[0, 1, 2, 3].map((i) => (
                <div className="summary-card" key={i}>
                  <Skeleton height={28} style={{ margin: '0 auto 8px' }} />
                  <Skeleton height={11} width="70%" style={{ margin: '0 auto' }} />
                </div>
              ))}
            </div>
            <Skeleton height={220} />
          </div>
        )}
        {employeeDetailError && <div className="error-text">{employeeDetailError}</div>}

        {employeeDetail && !employeeDetailLoading && (
          <>
            <div className="summary-cards summary-cards-4" style={{ marginTop: 16, marginBottom: 16 }}>
              <div className="summary-card">
                <div className="value">{employeeDetail.avgArrival ?? '—'}</div>
                <div className="label">Avg Arrival Time</div>
              </div>
              <div className="summary-card">
                <div className="value">{employeeDetail.avgDeparture ?? '—'}</div>
                <div className="label">Avg Departure Time</div>
              </div>
              <div className="summary-card">
                <div className="value">{employeeDetail.dailyHours.filter((d) => d.missingExit).length}</div>
                <div className="label">Missing Exits</div>
              </div>
              <div className="summary-card">
                <div className="value">{employeeDetail.dailyHours.filter((d) => d.hours !== null).length}</div>
                <div className="label">Days With Duration Tracked</div>
              </div>
            </div>
            <div>
              <h4 style={{ marginBottom: 4 }}>Daily Duration</h4>
              <ChartHint>Click a day's point to open that employee's full record for that day.</ChartHint>
              {employeeHoursConfig && <ChartCanvas config={employeeHoursConfig} />}
            </div>
            {employeeDistributionConfig && (
              <div style={{ marginTop: 16 }}>
                <h4 style={{ marginBottom: 4 }}>How This Employee Compares</h4>
                <ChartHint>
                  Every active employee's own average duration for this range, bucketed to the nearest quarter hour — this employee's point on the curve is
                  highlighted{employeeDetail?.employeeAvgHours !== null ? ` (they average ${employeeDetail?.employeeAvgHours}h)` : ''}. Click a point to see
                  who's in that bucket.
                </ChartHint>
                <ChartCanvas config={employeeDistributionConfig} />
                {distributionBucket && (
                  <div className="modal-overlay" role="presentation">
                    <div
                      ref={distributionBucketModalRef}
                      className="modal-card"
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby="distribution-bucket-title"
                      style={{ textAlign: 'left', maxWidth: 460, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
                    >
                      <h3 id="distribution-bucket-title" style={{ marginTop: 0, textAlign: 'center' }}>
                        ~{distributionBucket.hours}h average ({distributionBucket.employees.length})
                      </h3>
                      <div className="sticky-thead">
                        <table>
                          <thead>
                            <tr>
                              <th>Employee</th>
                              <th>Avg Duration (hrs)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {distributionBucket.employees.map((e) => (
                              <tr key={e.name} style={e.name === employeeDetail?.employee.employeeName ? { fontWeight: 600 } : undefined}>
                                <td>{e.name}</td>
                                <td>{e.hours}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="modal-actions" style={{ marginTop: 16 }}>
                        <button ref={distributionBucketCloseRef} type="button" className="cancel-btn" onClick={() => setDistributionBucket(null)}>
                          Close
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Marks the boundary below which every section covers the whole
          roster, not the employee selected above — a thin text divider
          wasn't prominent enough to actually register while scrolling, so
          this is a solid colored banner instead (same accent color as the
          Per-Employee Detail card's left border above, continuing the
          visual language rather than introducing a new one). Direct user
          feedback, 2026-10-14. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          margin: '0 0 16px',
          padding: '10px 16px',
          background: 'var(--brand-dark)',
          borderRadius: 'var(--radius-md)',
          color: '#fff',
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.4px',
          textTransform: 'uppercase',
        }}
      >
        <IconUsers style={{ width: 18, height: 18, flexShrink: 0 }} />
        Organization-Wide — Everyone, Not Just The Employee Above
      </div>

      {/* First load (or a load that's still in flight with nothing cached
          yet) — shape-of-the-page skeletons instead of a blank gap under
          the loading overlay. Direct user feedback, 2026-10-14. */}
      {!summary && !error && (
        <>
          <SkeletonCard chartHeight={100} />
          <SkeletonCard />
          <SkeletonCard />
        </>
      )}

      {/* Data-quality check comes ahead of every attendance/trend chart
          below — worth confirming the data itself is trustworthy before
          reading conclusions built on top of it. Only Per-Employee Detail
          (and the Daily Roster trigger, now folded into the filters-bar
          next to Employee) sit earlier. Moved up from the bottom of the
          page per direct user feedback, 2026-10. */}
      {summary && (
        <div id="duration-exceptions" className="section-card" style={{ marginBottom: 16 }}>
          <h3>
            Duration Exceptions
            <span className="section-eyebrow-badge">ORGANIZATION</span>
          </h3>
          <ChartHint>
            On-premises time, entry to exit — includes time spent outside the gate between taps, not verified working hours. Short-Duration = under{' '}
            {summary.shiftReference.expectedHours}h that day; Long-Duration = {summary.hoursLongDuration.threshold}h or more. Only days with both an
            entry and an exit are counted. Click a card to see who.
            {dayScope === 'weekends' && ' These thresholds assume a standard working day — treat weekend numbers as informational, not a compliance read.'}
          </ChartHint>
          {/* Missing Entries/Missing Exits/Corrected Records cards hidden
              2026-10-13, by request — not deleted, decide later whether to
              bring them back or remove for good. That data is still shown
              in the Missing Movements Trend chart below and still exported;
              only these three KPI-card buttons are hidden.
          <button
            type="button"
            className="summary-card clickable"
            onClick={() => openDrillDown('missingEntry', { from, to, ...activeFilters() }, `Missing entries (${from} to ${to})`)}
          >
            <div className="value">{summary.exceptions.missingEntries}</div>
            <div className="label">Missing Entries</div>
          </button>
          <button
            type="button"
            className="summary-card clickable"
            onClick={() => openDrillDown('missingExit', { from, to, ...activeFilters() }, `Missing exits (${from} to ${to})`)}
          >
            <div className="value">{summary.exceptions.missingExits}</div>
            <div className="label">Missing Exits</div>
          </button>
          <button
            type="button"
            className="summary-card clickable"
            onClick={() => openDrillDown('corrected', { from, to, ...activeFilters() }, `Corrected records (${from} to ${to})`)}
          >
            <div className="value">{summary.exceptions.correctedRecords}</div>
            <div className="label">Corrected Records</div>
          </button>
          */}
          <div className="summary-cards" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            <button
              type="button"
              className="summary-card highlight clickable"
              title={`Short-Duration day = (last exit − first entry) under ${summary.shiftReference.expectedHours}h that day. Only days with both an entry and an exit count.`}
              onClick={() => openDrillDown('shortfall', { from, to, ...activeFilters() }, `Short-duration days (${from} to ${to})`)}
            >
              <div className="value">
                {summary.hoursShortfall.totalEmployeeDays > 0
                  ? `${Math.round((summary.hoursShortfall.shortfallDays / summary.hoursShortfall.totalEmployeeDays) * 100)}%`
                  : '—'}
              </div>
              <div className="label">Short-Duration (Under {summary.shiftReference.expectedHours}h)</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                {summary.hoursShortfall.shortfallDays} of {summary.hoursShortfall.totalEmployeeDays} tracked days
              </div>
            </button>
            <button
              type="button"
              className="summary-card highlight clickable"
              title={`Long-Duration day = (last exit − first entry) ${summary.hoursLongDuration.threshold}h or more that day. Only days with both an entry and an exit count.`}
              onClick={() => openDrillDown('longDuration', { from, to, ...activeFilters() }, `Long-duration days (${from} to ${to})`)}
            >
              <div className="value">
                {summary.hoursLongDuration.totalEmployeeDays > 0
                  ? `${Math.round((summary.hoursLongDuration.longDurationDays / summary.hoursLongDuration.totalEmployeeDays) * 100)}%`
                  : '—'}
              </div>
              <div className="label">Long-Duration (Over {summary.hoursLongDuration.threshold}h)</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                {summary.hoursLongDuration.longDurationDays} of {summary.hoursLongDuration.totalEmployeeDays} tracked days
              </div>
            </button>
          </div>
        </div>
      )}

      {loading && !summary && <TableSkeleton columns={4} />}

      {error && <div className="error-text">{error}</div>}

      {summary && (
        <>
          {summary.attendanceTrend.length === 0 ? (
            <div className="empty-state">
              <IconInbox />
              <div className="empty-title">No movements in this range</div>
              <div className="empty-hint">Try a wider date range or clear the team/unit filter.</div>
            </div>
          ) : (
            // min(380px, 100%), not a bare 380px — on a narrow phone the
            // container itself is under 380px, and a bare minmax forces
            // every card to that fixed minimum regardless, overflowing the
            // page horizontally by exactly the difference. Found in the
            // 2026-10 mobile-overflow audit.
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(380px, 100%), 1fr))', gap: 16 }}>
              {/* Daily Entries/Exits/Employees Present, Daily Attendance
                  Rate, Missing Movements Trend, and Unit Activity hidden
                  2026-10-13, by request — not deleted, decide later whether
                  to bring them back or remove for good.
              <div className="section-card">
                <h3>Daily Entries, Exits &amp; Employees Present</h3>
                <ChartHint>Bars are raw taps; the line is employees present — the gap is repeat taps from the same people. Click a bar for that day's entries and exits.</ChartHint>
                {attendanceConfig && <ChartCanvas config={attendanceConfig} />}
              </div>
              <div className="section-card">
                <h3>Daily Attendance Rate</h3>
                <ChartHint>Share of the {summary.totalRosterSize}-person roster that tapped in each day. Click a point to see who had no movement that day.</ChartHint>
                {attendanceRateConfig && <ChartCanvas config={attendanceRateConfig} />}
              </div>
              */}
              {/* opacity dims during a filter-triggered refetch (loading &&
                  summary) — the header spinner at the top of the page was
                  otherwise the only cue that a stale chart on screen wasn't
                  current yet. Found in the 2026-10-27 design audit. */}
              <div className="section-card" style={{ opacity: loading && summary ? 0.55 : 1, transition: 'opacity 0.15s ease' }}>
                <h3>
                  Avg Duration, Short &amp; Long-Duration Days
                  <span className="section-eyebrow-badge">ORGANIZATION</span>
                </h3>
                <ChartHint>On-premises time, entry to exit (see legend). Click a bar to see who.</ChartHint>
                {avgDurationTrendConfig && <ChartCanvas config={avgDurationTrendConfig} />}
              </div>
              {/*
              <div className="section-card">
                <h3>Missing Movements Trend</h3>
                <ChartHint>
                  An entry with no matching exit, or vice versa, that day — usually a missed tap, not evidence of absence or misconduct. Click a bar to
                  see who.
                </ChartHint>
                {missingExitsConfig && <ChartCanvas config={missingExitsConfig} />}
              </div>
              */}
              <div className="section-card" style={{ opacity: loading && summary ? 0.55 : 1, transition: 'opacity 0.15s ease' }}>
                <h3>
                  Hourly Entry &amp; Exit Distribution
                  <span className="section-eyebrow-badge">ORGANIZATION</span>
                </h3>
                <ChartHint>What time of day movements cluster, across the range. Click a bar for that hour's movements.</ChartHint>
                {hourlyConfig && <ChartCanvas config={hourlyConfig} />}
              </div>
              {/*
              <div className="section-card">
                <h3>Unit Activity (Security 1 / 2)</h3>
                <ChartHint>How many entries/exits each security account recorded. Click a bar to see the actual movements.</ChartHint>
                {unitActivityConfig && <ChartCanvas config={unitActivityConfig} />}
              </div>
              */}
            </div>
          )}

          {(deptComparisonLoading || deptComparisonError || (deptComparisonBreakdown && deptComparisonBreakdown.length > 0)) && (
            <div id="dept-comparison" className="section-card heavy" style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <h3>
                    Department Comparison
                    <span className="section-eyebrow-badge">TEAM</span>
                    {deptComparisonLoading && <span className="spinner dark" style={{ marginLeft: 10 }} aria-label="Loading…" />}
                  </h3>
                  <ChartHint>
                    Each metric is its own chart with its own sort toggle. Number after each name is team size — a 2-person team's one bad day isn't a
                    department-wide pattern. Click a bar to see that department's employees.
                    {team && ' The top Team filter doesn\'t apply here (it would leave nothing to compare) — use the filter below instead.'}
                    {dayScope === 'weekends' && ' Showing weekend-only data — Short-Duration/Overtime % assume a standard working day, so treat them as informational here.'}
                  </ChartHint>
                </div>
                {/* Collapsed by default — this is the heaviest section on the
                    page (three full-width charts), not needed on every visit.
                    Direct user feedback, 2026-10-14. */}
                <button
                  type="button"
                  className="table-action-btn"
                  onClick={() => setDeptComparisonExpanded((e) => !e)}
                  aria-expanded={deptComparisonExpanded}
                >
                  {deptComparisonExpanded ? 'Hide charts ▲' : 'Show charts ▼'}
                </button>
              </div>
              {deptComparisonExpanded && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <div className="field" style={{ marginBottom: 0, width: '100%', maxWidth: 260 }}>
                      <label>
                        <TeamMultiSelect
                          teams={teams}
                          selected={deptComparisonTeamFilter}
                          onChange={setDeptComparisonTeamFilter}
                          ariaLabel="Choose which departments to compare"
                        />
                      </label>
                    </div>
                  </div>
                  {deptComparisonError ? (
                    <div style={{ padding: '16px 0' }}>
                      <div className="error-text">{deptComparisonError}</div>
                      <button type="button" className="quick-date-btn" style={{ marginTop: 8 }} onClick={() => setDeptComparisonRetry((n) => n + 1)}>
                        Retry
                      </button>
                    </div>
                  ) : deptComparisonLoading && !deptComparisonBreakdown ? (
                    <>
                      <Skeleton height={300} />
                      <Skeleton height={300} style={{ marginTop: 16 }} />
                      <Skeleton height={300} style={{ marginTop: 16 }} />
                    </>
                  ) : (
                    <>
                      {[
                        { config: departmentComparisonHoursConfig, title: 'Median Duration', dir: medianSortDir, setDir: setMedianSortDir },
                        { config: departmentComparisonShortfallConfig, title: 'Short-Duration', dir: shortfallSortDir, setDir: setShortfallSortDir },
                        { config: departmentComparisonOvertimeConfig, title: 'Overtime', dir: overtimeSortDir, setDir: setOvertimeSortDir },
                      ].map(
                        (chart) =>
                          chart.config && (
                            <div key={chart.title} style={{ marginTop: 16 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
                                <h4 style={{ margin: 0 }}>{chart.title}</h4>
                                <button
                                  type="button"
                                  className="quick-date-btn"
                                  onClick={() => chart.setDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                                  aria-label={`Toggle ${chart.title} sort direction`}
                                >
                                  {chart.dir === 'desc' ? 'Highest first ▼' : 'Lowest first ▲'}
                                </button>
                              </div>
                              <ChartCanvas config={chart.config} height={380} />
                            </div>
                          ),
                      )}
                      {!departmentComparisonHoursConfig && !departmentComparisonShortfallConfig && !departmentComparisonOvertimeConfig && (
                        <div className="empty-state" style={{ padding: '16px 0' }}>
                          <IconInbox />
                          <div className="empty-title">No departments selected</div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {summary.teamBreakdown.length > 0 && (
            <div id="team-breakdown" className="section-card" style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <h3>
                    Team Breakdown — Detail
                    <span className="section-eyebrow-badge">TEAM</span>
                  </h3>
                  <ChartHint>
                    "Team Size" is the full roster. "Days Present" is a team total: every employee's tap-in days added together over the range (any tap
                    counts, even without a matching exit) — not a day count or headcount. E.g. 10 people × 20 days each = 200. Click a row for every
                    employee on that team, or a header to sort.
                  </ChartHint>
                </div>
                <button
                  type="button"
                  className="table-action-btn"
                  disabled={exportingKeys.has('insights-team-breakdown')}
                  onClick={() => {
                    const qp = new URLSearchParams({ from, to, ...activeFilters() });
                    downloadExcel('insights-team-breakdown', `/api/insights/export/team-breakdown?${qp.toString()}`);
                  }}
                >
                  {exportingKeys.has('insights-team-breakdown') ? 'Exporting…' : 'Export to Excel'}
                </button>
              </div>
              <div className="scroll-hint">Scroll sideways for more columns →</div>
              <div className="sticky-head-scroll" style={{ overflowX: 'auto' }}>
              <table className="records-table">
                <thead>
                  <tr>
                    <Th label="Team" sortKey="team" sort={teamTableSort} onSort={(key) => setTeamTableSort((p) => toggleSort(p, key))} />
                    <Th label="Team Size" sortKey="employeeCount" sort={teamTableSort} onSort={(key) => setTeamTableSort((p) => toggleSort(p, key))} />
                    <Th label="Entries" sortKey="entries" sort={teamTableSort} onSort={(key) => setTeamTableSort((p) => toggleSort(p, key))} />
                    <Th label="Exits" sortKey="exits" sort={teamTableSort} onSort={(key) => setTeamTableSort((p) => toggleSort(p, key))} />
                    <Th label="Days Present" sortKey="employeeDays" sort={teamTableSort} onSort={(key) => setTeamTableSort((p) => toggleSort(p, key))} />
                    <Th label="Avg Duration" sortKey="avgHours" sort={teamTableSort} onSort={(key) => setTeamTableSort((p) => toggleSort(p, key))} />
                    <Th
                      label={`Short-Duration Days (Under ${summary.shiftReference.expectedHours}h)`}
                      sortKey="shortfallRate"
                      sort={teamTableSort}
                      onSort={(key) => setTeamTableSort((p) => toggleSort(p, key))}
                    />
                  </tr>
                </thead>
                <tbody>
                  {sortRows(
                    // Rated against daysWithHoursTracked (days with an actual
                    // measured duration), not employeeDays (which also
                    // includes missing-exit days with no duration at all) —
                    // the latter would understate the rate for any team with
                    // missing exits. Fixed 2026-10-13, by request.
                    summary.teamBreakdown.map((t) => ({
                      ...t,
                      shortfallRate: t.daysWithHoursTracked > 0 ? t.shortfallDays / t.daysWithHoursTracked : 0,
                    })),
                    teamTableSort,
                  ).map((t) => (
                    <tr
                      key={t.team}
                      onClick={() => openDrillDown('team', { from, to, ...activeFilters(), team: t.team }, `${t.team} team`)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>{t.team}</td>
                      <td>{t.employeeCount}</td>
                      <td>{t.entries}</td>
                      <td>{t.exits}</td>
                      <td>{t.employeeDays}</td>
                      <td>{t.avgHours ?? '—'}</td>
                      <td>
                        {t.shortfallDays} {t.daysWithHoursTracked > 0 ? `(${Math.round(t.shortfallRate * 100)}%)` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </>
      )}

      {dailyDurationOpen && (
        <div className="modal-overlay" role="presentation">
          <div
            ref={dailyDurationModalRef}
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="daily-duration-title"
            style={{ textAlign: 'left', maxWidth: 760, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
          >
            <h3 id="daily-duration-title" style={{ marginTop: 0, textAlign: 'center' }}>
              Daily Roster
            </h3>

            {!dailyDurationLoading && !dailyDurationError && dailyDuration && dailyDurationNoMovement && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, justifyContent: 'center' }}>
                <button
                  type="button"
                  className={`quick-date-btn ${dailyDurationView === 'present' ? 'active' : ''}`}
                  onClick={() => setDailyDurationView('present')}
                >
                  Tapped In ({dailyDuration.length})
                </button>
                <button
                  type="button"
                  className={`quick-date-btn ${dailyDurationView === 'noMovement' ? 'active' : ''}`}
                  onClick={() => setDailyDurationView('noMovement')}
                  title="Not confirmed absence — could be leave, a holiday, remote work, or a forgotten tap."
                >
                  No Movement Recorded ({dailyDurationNoMovement.length})
                </button>
              </div>
            )}

            <div className="filters-bar" style={{ marginTop: 0, marginBottom: 12, flexWrap: 'wrap' }}>
              <div className="field" style={{ flex: 1, minWidth: 150 }}>
                <label>
                  Date
                  <input type="date" value={dailyDurationDate} onChange={(e) => setDailyDurationDate(e.target.value)} max={todayIso()} />
                </label>
              </div>
              <div className="field" style={{ flex: 1, minWidth: 150 }}>
                <label>
                  Search
                  <div style={{ position: 'relative' }}>
                    <input
                      placeholder="Name or code…"
                      value={dailyDurationQuery}
                      onChange={(e) => setDailyDurationQuery(e.target.value)}
                      style={{ width: '100%', paddingRight: dailyDurationQuery ? 36 : undefined }}
                    />
                    {dailyDurationQuery && (
                      <button type="button" className="search-clear-btn" onClick={() => setDailyDurationQuery('')} aria-label="Clear search">
                        <IconX />
                      </button>
                    )}
                  </div>
                </label>
              </div>
              <div className="field" style={{ flex: 1, minWidth: 150 }}>
                <label>
                  Team
                  <TeamMultiSelect teams={teams} selected={dailyDurationTeamFilter} onChange={setDailyDurationTeamFilter} ariaLabel="Filter by team" />
                </label>
              </div>
            </div>

            {dailyDurationLoading && <TableSkeleton columns={5} />}
            {dailyDurationError && <div className="error-text">{dailyDurationError}</div>}

            {!dailyDurationLoading && !dailyDurationError && dailyDuration && dailyDuration.length === 0 && dailyDurationView === 'present' && (
              <div className="empty-state" style={{ padding: '16px 0' }}>
                <IconInbox />
                <div className="empty-title">No movements recorded on this date</div>
              </div>
            )}

            {!dailyDurationLoading &&
              !dailyDurationError &&
              dailyDuration &&
              dailyDuration.length > 0 &&
              dailyDurationView === 'present' &&
              (() => {
                const q = dailyDurationQuery.trim().toLowerCase();
                const visibleRows = sortRows(
                  dailyDuration
                    .filter((r) => !q || r.employeeName.toLowerCase().includes(q) || r.employeeCode.toLowerCase().includes(q))
                    .filter((r) => dailyDurationTeamFilter.length === 0 || (r.team !== null && dailyDurationTeamFilter.includes(r.team))),
                  dailyDurationSort,
                );

                if (visibleRows.length === 0) {
                  return (
                    <div className="empty-state" style={{ padding: '16px 0' }}>
                      <IconInbox />
                      <div className="empty-title">
                        No matches
                        {dailyDurationQuery ? ` for "${dailyDurationQuery}"` : ''}
                        {dailyDurationTeamFilter.length > 0 ? ` in ${dailyDurationTeamFilter.join(', ')}` : ''}
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="sticky-thead" style={{ overflowX: 'auto' }}>
                    <table className="records-table">
                      <thead>
                        <tr>
                          <Th
                            label="Employee"
                            sortKey="employeeName"
                            sort={dailyDurationSort}
                            onSort={(key) => setDailyDurationSort((p) => toggleSort(p, key))}
                          />
                          <Th
                            label="Team"
                            sortKey="team"
                            sort={dailyDurationSort}
                            onSort={(key) => setDailyDurationSort((p) => toggleSort(p, key))}
                          />
                          <Th
                            label="Duration"
                            sortKey="hours"
                            sort={dailyDurationSort}
                            onSort={(key) => setDailyDurationSort((p) => toggleSort(p, key))}
                          />
                          <Th
                            label="Status"
                            sortKey="status"
                            sort={dailyDurationSort}
                            onSort={(key) => setDailyDurationSort((p) => toggleSort(p, key))}
                          />
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRows.map((r) => (
                          <tr key={r.employeeId}>
                            <td>
                              <EmployeeLink employeeId={r.employeeId} employeeName={r.employeeName} date={dailyDurationDate} />
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.employeeCode}</div>
                            </td>
                            <td>{r.team ?? 'Unassigned'}</td>
                            <td>{r.hours !== null ? `${r.hours}h` : '—'}</td>
                            <td>
                              {r.status === 'complete' ? (
                                'Complete'
                              ) : (
                                <span style={{ color: EXIT_RED, fontWeight: 600 }}>
                                  {r.status === 'missingExit' ? 'Missing Exit' : r.status === 'missingBoth' ? 'Missing Both' : 'Missing Entry'}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}

            {!dailyDurationLoading &&
              !dailyDurationError &&
              dailyDurationNoMovement &&
              dailyDurationView === 'noMovement' &&
              (() => {
                const q = dailyDurationQuery.trim().toLowerCase();
                const visibleRows = sortRows(
                  dailyDurationNoMovement
                    .filter((r) => !q || r.employeeName.toLowerCase().includes(q) || r.employeeCode.toLowerCase().includes(q))
                    .filter((r) => dailyDurationTeamFilter.length === 0 || (r.team !== null && dailyDurationTeamFilter.includes(r.team))),
                  dailyDurationSort,
                );

                if (dailyDurationNoMovement.length === 0) {
                  return (
                    <div className="empty-state" style={{ padding: '16px 0' }}>
                      <IconInbox />
                      <div className="empty-title">Everyone on the roster tapped in that day</div>
                    </div>
                  );
                }

                if (visibleRows.length === 0) {
                  return (
                    <div className="empty-state" style={{ padding: '16px 0' }}>
                      <IconInbox />
                      <div className="empty-title">
                        No matches
                        {dailyDurationQuery ? ` for "${dailyDurationQuery}"` : ''}
                        {dailyDurationTeamFilter.length > 0 ? ` in ${dailyDurationTeamFilter.join(', ')}` : ''}
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="sticky-thead" style={{ overflowX: 'auto' }}>
                    <table className="records-table">
                      <thead>
                        <tr>
                          <Th
                            label="Employee"
                            sortKey="employeeName"
                            sort={dailyDurationSort}
                            onSort={(key) => setDailyDurationSort((p) => toggleSort(p, key))}
                          />
                          <Th label="Team" sortKey="team" sort={dailyDurationSort} onSort={(key) => setDailyDurationSort((p) => toggleSort(p, key))} />
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRows.map((r) => (
                          <tr key={r.employeeId}>
                            <td>
                              <EmployeeLink employeeId={r.employeeId} employeeName={r.employeeName} date={dailyDurationDate} />
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.employeeCode}</div>
                            </td>
                            <td>{r.team ?? 'Unassigned'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}

            <div className="modal-actions" style={{ marginTop: 16 }}>
              {!dailyDurationLoading && !dailyDurationError && dailyDuration && dailyDuration.length > 0 && dailyDurationView === 'present' && (
                <button
                  type="button"
                  className="cancel-btn"
                  disabled={exportingKeys.has('insights-daily-duration')}
                  title="Exports the Tapped In list — No Movement Recorded isn't included."
                  onClick={() => {
                    const qp = new URLSearchParams({ date: dailyDurationDate, dayScope, ...(team ? { team } : {}), ...(unitId ? { unitId } : {}) });
                    downloadExcel('insights-daily-duration', `/api/insights/export/daily-duration?${qp.toString()}`);
                  }}
                >
                  {exportingKeys.has('insights-daily-duration') ? 'Exporting…' : 'Export to Excel'}
                </button>
              )}
              <button ref={dailyDurationCloseRef} type="button" className="cancel-btn" onClick={() => setDailyDurationOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {drillDown && (
        <div className="modal-overlay" role="presentation">
          <div
            ref={drillDownModalRef}
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="drilldown-title"
            style={{ textAlign: 'left', maxWidth: 820, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
          >
            <h3 id="drilldown-title" style={{ marginTop: 0, textAlign: 'center' }}>
              {drillDown.title}
            </h3>

            {drillDown.loading && (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <span className="spinner dark" />
              </div>
            )}

            {drillDown.error && <div className="error-text">{drillDown.error}</div>}

            {!drillDown.loading && !drillDown.error && drillDown.rows.length === 0 && (
              <div className="empty-state" style={{ padding: '16px 0' }}>
                <IconInbox />
                <div className="empty-title">Nothing here</div>
              </div>
            )}

            {!drillDown.loading && !drillDown.error && drillDown.rows.length > 0 && (
              <>
                {/* The backend caps this at 500 rows with no pagination
                    affordance here (unlike a paginated list's Load More) —
                    without this, a large range/team's drill-down looked
                    complete when it silently wasn't. Found in the
                    2026-10-28 audit. */}
                {drillDown.truncated && (
                  <div className="status-banner pending" style={{ marginBottom: 10 }}>
                    Showing the first 500 rows — narrow the date range or team/unit filter to see the rest.
                  </div>
                )}
                {drillDown.rows.length > 8 && (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                    <div className="field" style={{ position: 'relative', flex: 1, minWidth: 160, margin: 0 }}>
                      <input
                        aria-label="Search by employee name or code"
                        placeholder="Search by name or code…"
                        value={drillDownSearch}
                        onChange={(e) => setDrillDownSearch(e.target.value)}
                        style={{ width: '100%', paddingRight: drillDownSearch ? 36 : undefined }}
                      />
                      {drillDownSearch && (
                        <button type="button" className="search-clear-btn" onClick={() => setDrillDownSearch('')} aria-label="Clear search">
                          <IconX />
                        </button>
                      )}
                    </div>
                    {/* metric=team is already scoped to one team (the
                        title names it), so this filter is only useful —
                        and only shown — for the metrics that can span
                        multiple teams. Direct user feedback, 2026-10. */}
                    {drillDown.metric !== 'team' && (
                      <div style={{ flex: '0 1 200px' }}>
                        <TeamMultiSelect teams={teams} selected={drillDownTeamFilter} onChange={setDrillDownTeamFilter} ariaLabel="Filter by team" />
                      </div>
                    )}
                  </div>
                )}
                <div className="sticky-thead" style={{ overflowX: 'auto' }}>
                  <DrillDownTable
                    metric={drillDown.metric}
                    rows={drillDown.rows}
                    date={drillDown.date}
                    fallbackDate={to}
                    search={drillDownSearch}
                    teamFilter={drillDownTeamFilter}
                    sort={drillDownSort}
                    onSort={(key) => setDrillDownSort((prev) => toggleSort(prev, key))}
                    onSelectEmployee={(r) => {
                      setSelectedEmployee({
                        id: r.employeeId,
                        employeeCode: r.employeeCode,
                        employeeName: r.employeeName,
                        email: null,
                        isActive: r.isActive,
                        team: drillDown.params.team ?? null,
                      });
                      closeDrillDown();
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                  />
                </div>
              </>
            )}

            <div className="modal-actions" style={{ marginTop: 16 }}>
              {!drillDown.loading && !drillDown.error && drillDown.rows.length > 0 && (
                <button
                  type="button"
                  className="cancel-btn"
                  disabled={exportingKeys.has('drilldown')}
                  onClick={() => {
                    const qp = new URLSearchParams({ metric: drillDown.metric, ...drillDown.params });
                    downloadExcel('drilldown', `/api/insights/export/drill-down?${qp.toString()}`);
                  }}
                >
                  {exportingKeys.has('drilldown') ? 'Exporting…' : 'Export to Excel'}
                </button>
              )}
              <button ref={drillDownCloseRef} type="button" className="cancel-btn" onClick={closeDrillDown}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      <BackToTop />
    </div>
  );
}

function ChartHint({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '-4px 0 10px' }}>{children}</p>;
}

function Skeleton({ width = '100%', height = 16, style }: { width?: string | number; height?: string | number; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ width, height, ...style }} />;
}

// Stands in for one section-card's shape (title + a chart-sized block)
// while that section's own data hasn't arrived yet.
function SkeletonCard({ chartHeight = 240 }: { chartHeight?: number }) {
  return (
    <div className="section-card" style={{ marginTop: 16 }}>
      <Skeleton width={180} height={14} style={{ marginBottom: 12 }} />
      <Skeleton width="55%" height={11} style={{ marginBottom: 20 }} />
      <Skeleton height={chartHeight} />
    </div>
  );
}

// Checkbox dropdown generalized from the original Team-only version (still
// used in every modal — Daily Roster, every drill-down — and now also for
// Department Comparison's metric picker). These only filter rows/series
// already loaded in the browser, so picking several at once is a
// client-side change, not a new API call. Trigger styled to match .field
// select; options list reuses .search-results' existing button-row styling.
function MultiSelect({
  options,
  selected,
  onChange,
  ariaLabel,
  allLabel,
  noun,
  clearAriaLabel,
}: {
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
  ariaLabel: string;
  allLabel: string;
  noun: string;
  clearAriaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeIfOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    // A keyboard user could open this dropdown but had no way to close it
    // short of clicking elsewhere or tabbing through every option — every
    // custom dropdown in the app had the same gap. Found in the 2026-10-29
    // dropdown audit.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeIfOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeIfOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const selectedLabels = options.filter((o) => selected.includes(o.value)).map((o) => o.label);
  const label = selectedLabels.length === 0 ? allLabel : selectedLabels.length === 1 ? selectedLabels[0] : `${selectedLabels.length} ${noun}`;

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={ariaLabel}
        aria-expanded={open}
        style={{
          width: '100%',
          padding: selected.length > 0 ? '12px 44px 12px 14px' : '12px 14px',
          borderRadius: 'var(--radius-sm)',
          border: '1.5px solid var(--border)',
          background: 'var(--card-bg)',
          fontSize: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <IconChevronRight style={{ width: 14, height: 14, transform: 'rotate(90deg)', color: 'var(--text-muted)', flexShrink: 0 }} />
      </button>
      {/* A sibling of the trigger <button> above, not nested inside it — it
          used to be a <span role="button"> nested inside that button (no
          tabIndex/onKeyDown despite the role, and only a bare 14px tap
          target), which is both unreachable by keyboard and invalid HTML
          (a button can't contain another interactive control). Reuses
          .search-clear-btn, the same absolute-positioned clear control the
          employee-search boxes already use. Found in the 2026-10-29
          dropdown audit. */}
      {selected.length > 0 && (
        <button
          type="button"
          className="search-clear-btn"
          aria-label={clearAriaLabel}
          onClick={(e) => {
            e.stopPropagation();
            onChange([]);
          }}
        >
          <IconX />
        </button>
      )}
      {open && (
        <div className="search-results">
          {options.map((o) => {
            const checked = selected.includes(o.value);
            return (
              <button key={o.value} type="button" onClick={() => onChange(checked ? selected.filter((x) => x !== o.value) : [...selected, o.value])}>
                <span style={{ width: 16, flexShrink: 0, color: 'var(--brand-dark)' }}>{checked && <IconCheck style={{ width: 14, height: 14 }} />}</span>
                <span>{o.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Single-pick counterpart to MultiSelect — same bordered-trigger/checklist-
// panel look (a checkmark next to the chosen option, not a radio or a
// native OS dropdown), for the Team/Unit/Movement/Days filters above. Picking
// an option closes the panel immediately, unlike MultiSelect which stays
// open for picking several. Direct user feedback, 2026-10-14.
function SingleSelect({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // A value restored from sessionStorage (e.g. unitId) can stop appearing in
  // `options` later — e.g. the Unit list narrowed to SECURITY-role recorders
  // only, dropping a previously-selected admin. Without this, the label
  // fallback below silently displayed "All units" while the stale value was
  // still being applied to every chart — the control visually disagreed with
  // what was actually filtered. Reset rather than keep showing a value that
  // doesn't resolve to any option. Found in the 2026-10-29 review.
  useEffect(() => {
    if (value && options.length > 0 && !options.some((o) => o.value === value)) {
      onChange('');
    }
  }, [value, options, onChange]);

  useEffect(() => {
    if (!open) return;
    const closeIfOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    // A keyboard user could open this dropdown but had no way to close it
    // short of clicking elsewhere or tabbing through every option — every
    // custom dropdown in the app had the same gap. Found in the 2026-10-29
    // dropdown audit.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeIfOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeIfOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const label = options.find((o) => o.value === value)?.label ?? options[0]?.label ?? '';

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={ariaLabel}
        aria-expanded={open}
        // fontSize 13 (not the .field input's 16) — this is a custom toggle
        // button, not an editable text input, so it was never subject to
        // iOS's auto-zoom-on-focus (the reason .field input/select stays at
        // 16). At 16px it read oversized next to the 12-12.5px pills/
        // buttons sharing this row. Padding bumped to 14px to keep the same
        // ~47px height despite the smaller font. Direct user feedback,
        // 2026-10-19.
        style={{
          width: '100%',
          padding: '14px',
          borderRadius: 'var(--radius-sm)',
          border: '1.5px solid var(--border)',
          background: 'var(--card-bg)',
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <IconChevronRight style={{ width: 14, height: 14, transform: 'rotate(90deg)', color: 'var(--text-muted)', flexShrink: 0 }} />
      </button>
      {open && (
        <div className="search-results">
          {options.map((o) => {
            const checked = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                <span style={{ width: 16, flexShrink: 0, color: 'var(--brand-dark)' }}>{checked && <IconCheck style={{ width: 14, height: 14 }} />}</span>
                <span>{o.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TeamMultiSelect({ teams, selected, onChange, ariaLabel }: { teams: string[]; selected: string[]; onChange: (next: string[]) => void; ariaLabel: string }) {
  return (
    <MultiSelect
      options={teams.map((t) => ({ value: t, label: t }))}
      selected={selected}
      onChange={onChange}
      ariaLabel={ariaLabel}
      allLabel="All teams"
      noun="teams"
      clearAriaLabel="Clear team selection"
    />
  );
}

type DrillDownSort = { key: string; dir: 'asc' | 'desc' } | null;

// Sortable column header shared by every metric's table below — clicking
// toggles asc/desc on the same column, or switches to a new one.
function Th({ label, sortKey, sort, onSort }: { label: string; sortKey: string; sort: DrillDownSort; onSort?: (key: string) => void }) {
  const active = sort?.key === sortKey;
  if (!onSort) return <th>{label}</th>;
  // tabIndex/role/onKeyDown added 2026-10-29 — same fix as
  // components/SortableTh.tsx's Th: an onClick-only <th> was mouse-only.
  return (
    <th
      onClick={() => onSort(sortKey)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSort(sortKey);
        }
      }}
      tabIndex={0}
      role="button"
      aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
    >
      {label}
      {active ? (sort!.dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );
}

// Shared by every sortable table's onSort handler (Team Breakdown, Daily
// Roster, every drill-down variant) — was the same toggle-asc/desc/new-key
// logic duplicated 11 times inline. Found in the 2026-10 optimization pass.
function toggleSort(prev: DrillDownSort, key: string): DrillDownSort {
  return prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' };
}

function sortRows(rows: any[], sort: DrillDownSort): any[] {
  if (!sort) return rows;
  return [...rows].sort((a, b) => {
    const av = a[sort.key];
    const bv = b[sort.key];
    const cmp = typeof av === 'number' || typeof bv === 'number' ? (av ?? -Infinity) - (bv ?? -Infinity) : String(av ?? '').localeCompare(String(bv ?? ''));
    return sort.dir === 'asc' ? cmp : -cmp;
  });
}

function DrillDownTable({
  metric,
  rows: rawRows,
  date,
  fallbackDate,
  search = '',
  teamFilter = [],
  sort = null,
  onSort,
  onSelectEmployee,
}: {
  metric: DrillDownMetric;
  rows: any[];
  date?: string;
  fallbackDate: string;
  search?: string;
  teamFilter?: string[];
  sort?: DrillDownSort;
  onSort?: (key: string) => void;
  // team rows are aggregated over the whole filter range — there's no
  // single day to link to (unlike every other metric's rows, which each
  // have a real date). Instead of a misleading link to one arbitrary day,
  // clicking selects the employee in Per-Employee Detail, which already
  // shows their trend for that exact range. Direct user feedback, 2026-10.
  onSelectEmployee?: (row: any) => void;
}) {
  const q = search.trim().toLowerCase();
  const filtered = rawRows
    .filter((r) => !q || r.employeeName?.toLowerCase().includes(q) || r.employeeCode?.toLowerCase().includes(q))
    .filter((r) => teamFilter.length === 0 || teamFilter.includes(r.team));
  const rows = sortRows(filtered, sort);

  if (filtered.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '16px 0' }}>
        <IconInbox />
        <div className="empty-title">
          No matches
          {search ? ` for "${search}"` : ''}
          {teamFilter.length > 0 ? ` in ${teamFilter.join(', ')}` : ''}
        </div>
      </div>
    );
  }

  if (metric === 'attendance' || metric === 'unit' || metric === 'hour') {
    const spansRange = metric !== 'attendance';
    // 'unit' is already scoped to one security user (the modal title names
    // them) — a Recorded By column there would just repeat the same name on
    // every row. 'attendance'/'hour' can span multiple recorders.
    const showRecordedBy = metric !== 'unit';
    return (
      <table className="records-table">
        <thead>
          <tr>
            <Th label="Employee" sortKey="employeeName" sort={sort} onSort={onSort} />
            <Th label={spansRange ? 'Date & Time' : 'Time'} sortKey="movementAt" sort={sort} onSort={onSort} />
            <Th label="Movement" sortKey="movementType" sort={sort} onSort={onSort} />
            {showRecordedBy && <Th label="Recorded By" sortKey="recordedByName" sort={sort} onSort={onSort} />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <EmployeeLink employeeId={r.employeeId} employeeName={r.employeeName} date={date ?? r.movementAt.slice(0, 10)} />
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.employeeCode}</div>
              </td>
              <td>{spansRange ? new Date(r.movementAt).toLocaleString('en-IN') : formatTime(r.movementAt)}</td>
              <td>
                <span className={`movement-badge ${r.movementType}`}>{r.movementType}</span>
              </td>
              {showRecordedBy && <td>{r.recordedByName}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (metric === 'shortfall' || metric === 'longDuration') {
    return (
      <table className="records-table">
        <thead>
          <tr>
            <Th label="Employee" sortKey="employeeName" sort={sort} onSort={onSort} />
            {!date && <Th label="Date" sortKey="date" sort={sort} onSort={onSort} />}
            <Th label="Duration that day" sortKey="hours" sort={sort} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <EmployeeLink employeeId={r.employeeId} employeeName={r.employeeName} date={date ?? r.date} />
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.employeeCode}</div>
              </td>
              {!date && <td>{r.date}</td>}
              <td>{r.hours}h</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (metric === 'missingExit' || metric === 'missingEntry') {
    // Range mode (no `date` prop — opened from the Exceptions KPI card,
    // not a chart bar) spans multiple days, so each row's own `date` is
    // shown and used for its link; day mode (chart bar click) already
    // knows the single day from `date`.
    const timeLabel = metric === 'missingExit' ? 'Entry Time' : 'Exit Time';
    const timeField = metric === 'missingExit' ? 'entryAt' : 'exitAt';
    return (
      <table className="records-table">
        <thead>
          <tr>
            <Th label="Employee" sortKey="employeeName" sort={sort} onSort={onSort} />
            {!date && <Th label="Date" sortKey="date" sort={sort} onSort={onSort} />}
            <Th label={timeLabel} sortKey={timeField} sort={sort} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <EmployeeLink employeeId={r.employeeId} employeeName={r.employeeName} date={date ?? r.date} />
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.employeeCode}</div>
              </td>
              {!date && <td>{r.date}</td>}
              <td>{formatTime(r[timeField])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (metric === 'corrected') {
    return (
      <table className="records-table">
        <thead>
          <tr>
            <Th label="Employee" sortKey="employeeName" sort={sort} onSort={onSort} />
            <Th label="Movement" sortKey="movementType" sort={sort} onSort={onSort} />
            <Th label="Time" sortKey="movementAt" sort={sort} onSort={onSort} />
            <Th label="Recorded By" sortKey="recordedByName" sort={sort} onSort={onSort} />
            <Th label="Corrected By" sortKey="correctedByName" sort={sort} onSort={onSort} />
            <Th label="Reason" sortKey="correctionReason" sort={sort} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <EmployeeLink employeeId={r.employeeId} employeeName={r.employeeName} date={r.movementAt.slice(0, 10)} />
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.employeeCode}</div>
              </td>
              <td>
                <span className={`movement-badge ${r.movementType}`}>{r.movementType}</span>
              </td>
              <td>{new Date(r.movementAt).toLocaleString('en-IN')}</td>
              <td>{r.recordedByName}</td>
              <td>{r.correctedByName}</td>
              <td>{r.correctionReason || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // team — each row is aggregated over the whole filter range, not any
  // single day, so a name click selects the employee in Per-Employee
  // Detail (same range) instead of linking to one arbitrary day.
  return (
    <table className="records-table">
      <thead>
        <tr>
          <Th label="Employee" sortKey="employeeName" sort={sort} onSort={onSort} />
          <Th label="Entries" sortKey="entries" sort={sort} onSort={onSort} />
          <Th label="Exits" sortKey="exits" sort={sort} onSort={onSort} />
          <Th label="Avg Duration" sortKey="avgHours" sort={sort} onSort={onSort} />
          <Th label="Short-Duration Days" sortKey="shortfallDays" sort={sort} onSort={onSort} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>
              {onSelectEmployee ? (
                <button
                  type="button"
                  className="employee-name-link"
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left' }}
                  onClick={() => onSelectEmployee(r)}
                >
                  {r.employeeName}
                </button>
              ) : (
                <EmployeeLink employeeId={r.employeeId} employeeName={r.employeeName} date={fallbackDate} />
              )}
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {r.employeeCode}
                {!r.isActive && ' · Inactive'}
              </div>
            </td>
            <td>{r.entries}</td>
            <td>{r.exits}</td>
            <td>{r.avgHours ?? '—'}</td>
            <td>
              {r.shortfallDays} {r.daysWithHoursTracked > 0 ? `(${Math.round((r.shortfallDays / r.daysWithHoursTracked) * 100)}%)` : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
