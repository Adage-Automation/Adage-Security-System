// Bulk employee import from CSV (spec §41). Validates every row before
// writing anything, then upserts by employee_code so re-running the same
// file (e.g. with corrections) is safe.
//
// Usage:
//   npm run import:employees -- data/employees.csv
//
// Expected CSV header: employee_code,employee_name,email,car_number
// Email may be blank until the employee's address is available. Department
// and designation columns are still accepted if present for compatibility.
// car_number is optional too -- most employees don't have this on file yet.

import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface EmployeeRow {
  employee_code: string;
  employee_name: string;
  email?: string;
  department?: string;
  designation?: string;
  car_number?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Source HR data tends to arrive ALL CAPS ("ADARSH BHASKARAN CHANABHAT").
// Every screen in the app displays employeeName directly (Security search,
// Dashboard, reports, emails) — normalize to Title Case on import so it
// reads properly everywhere, rather than importing raw. This also fixes a
// real regression found 2026-09-09: importing an ALL-CAPS roster
// overwrote 6 employees' names that had been manually title-cased earlier.
function toTitleCase(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((word) => (word.length ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word))
    .join(' ');
}

function validateRows(rows: EmployeeRow[]): string[] {
  const errors: string[] = [];
  const seenCodes = new Set<string>();

  rows.forEach((row, i) => {
    const line = i + 2; // +1 for 0-index, +1 for header row
    if (!row.employee_code?.trim()) errors.push(`Line ${line}: missing employee_code`);
    if (!row.employee_name?.trim()) errors.push(`Line ${line}: missing employee_name`);
    if (row.email?.trim() && !EMAIL_RE.test(row.email.trim())) {
      errors.push(`Line ${line}: invalid email "${row.email}"`);
    }
    if (row.employee_code && seenCodes.has(row.employee_code.trim())) {
      errors.push(`Line ${line}: duplicate employee_code "${row.employee_code}" within this file`);
    }
    if (row.employee_code) seenCodes.add(row.employee_code.trim());
  });

  return errors;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npm run import:employees -- <path-to-csv>');
    process.exit(1);
  }

  const csvContent = readFileSync(filePath, 'utf-8');
  const rows: EmployeeRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const errors = validateRows(rows);
  if (errors.length > 0) {
    console.error(`Validation failed — no rows were imported:\n`);
    errors.forEach((e) => console.error(`  ${e}`));
    process.exit(1);
  }

  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const data = {
      employeeName: toTitleCase(row.employee_name),
      email: row.email?.trim() || null,
      department: row.department?.trim() || null,
      designation: row.designation?.trim() || null,
      carNumber: row.car_number?.trim() || null,
    };

    const existing = await prisma.employee.findUnique({ where: { employeeCode: row.employee_code.trim() } });

    await prisma.employee.upsert({
      where: { employeeCode: row.employee_code.trim() },
      update: data,
      create: { employeeCode: row.employee_code.trim(), ...data },
    });

    if (existing) updated++;
    else created++;
  }

  console.log(`Import complete: ${created} created, ${updated} updated, ${rows.length} total rows processed.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
