// The fixed set of team/department values `Employee.team` is allowed to
// hold — a dropdown, not free text, so team-wise Insights charts don't
// fragment into near-duplicate labels ("Sales" vs "sales" vs "Sales Team").
// Single source of truth: the frontend fetches this list via
// GET /employees/teams rather than hardcoding its own copy, so the two
// can never drift apart. Given by the user, 2026-10-05.
// Title-cased per request, 2026-10-05 (not ALL CAPS) — genuine acronyms
// (APM, CEO, TM, WPS, AI) kept uppercase rather than title-cased into
// "Apm"/"Ceo"/etc., which would read as a typo rather than an acronym.
export const TEAMS = [
  'Management',
  'Stores',
  'Logistics',
  'Sales & Marketing Department',
  'Production',
  'Customer Support Department',
  'Procurement',
  'Finance & Accounts',
  'Quality Control',
  'Support Staff',
  'Strategic Business Unit - 1',
  'Strategic Business Unit - 3',
  'Information Technology',
  'Department of Happiness',
  'Strategic Business Unit - 2',
  'Sales & Services',
  'Admin',
  'APM',
  'Testing',
  'Commercial',
  'CEO Office',
  'TM & WPS',
  'AI & Digitalization',
  'Business Management',
  'Centre of Excellence',
  'Constructions',
] as const;
