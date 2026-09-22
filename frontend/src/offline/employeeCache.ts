// Lightweight offline fallback for the guard's employee search. The live
// /employees/search endpoint is deliberately NetworkOnly in the service
// worker (vite.config.ts) — without a local copy of the roster, a guard
// who opens the app already offline, or goes offline before picking a new
// employee, has no way to search for or select anyone at all. Refreshed
// opportunistically whenever the app is online; the last-known copy is
// used for offline searches even if it's a bit stale — a slightly
// out-of-date roster beats no roster. Found in the 2026-09-22 audit.
import { Employee } from '../types';

const STORAGE_KEY = 'adage.employee-cache';

interface CachedRoster {
  fetchedAt: string;
  employees: Employee[];
}

function readCache(): CachedRoster | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CachedRoster) : null;
  } catch {
    return null;
  }
}

export async function refreshEmployeeCache(): Promise<void> {
  const res = await fetch('/api/employees/offline-cache', { credentials: 'include' });
  if (!res.ok) return;
  const employees = (await res.json()) as Employee[];
  const payload: CachedRoster = { fetchedAt: new Date().toISOString(), employees };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Best-effort only — an offline search just falls back to whatever
    // (possibly nothing) was cached before.
  }
}

export function hasEmployeeCache(): boolean {
  return readCache() !== null;
}

// Mirrors EmployeesService.search's matching logic (name/code/email/car
// number, case-insensitive substring, capped at 10) so offline results
// look the same as online ones to the guard.
export function searchEmployeeCache(query: string): Employee[] {
  const cached = readCache();
  if (!cached) return [];
  const q = query.trim().toLowerCase();
  const matches = q
    ? cached.employees.filter(
        (e) =>
          e.employeeName.toLowerCase().includes(q) ||
          e.employeeCode.toLowerCase().includes(q) ||
          (e.email ?? '').toLowerCase().includes(q) ||
          (e.carNumber ?? '').toLowerCase().includes(q),
      )
    : cached.employees;
  return matches.slice(0, 10);
}
