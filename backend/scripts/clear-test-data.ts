// One-time pre-launch cleanup: wipes all movement records, email logs, and
// their related audit-log entries, while leaving employees, users, roles,
// permissions, and settings completely untouched. Meant to be run once,
// right before real guard usage begins, to clear out everything recorded
// while testing ENTRY/EXIT taps and EMAIL DETAILS sends. See
// docs/decisions.md and CHANGELOG.md for the record of when/why this ran.
//
// Requires --confirm so it can never run by accident (e.g. a stray
// `ts-node scripts/clear-test-data.ts` with no args just prints what it
// WOULD do and exits).
//
// Usage (from backend/): npx ts-node scripts/clear-test-data.ts --confirm

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Every audit-log action tied to a movement record or an email/report
// send — kept as an explicit allowlist (not "everything except employee/
// user actions") so this can never silently start deleting audit history
// for a future, unrelated action type someone adds later without updating
// this list.
const ACTIONS_TO_CLEAR = [
  'ENTRY_RECORDED',
  'EXIT_RECORDED',
  'RECORD_CORRECTED',
  'MISSING_RECORD_ADDED',
  'EMAIL_SENT',
  'EMAIL_FAILED',
  'REPORT_DOWNLOADED',
];

async function main() {
  const confirmed = process.argv.includes('--confirm');

  // Sequential, not Promise.all — the shared Supabase pooler is already
  // near its session-mode connection cap with production traffic, and
  // firing 5 queries at once from this script alone tipped it over
  // (EMAXCONNSESSION). One at a time uses one slot instead of five.
  const movementCount = await prisma.movementRecord.count();
  const emailCount = await prisma.emailLog.count();
  const auditCount = await prisma.auditLog.count({ where: { action: { in: ACTIONS_TO_CLEAR } } });
  const employeeCount = await prisma.employee.count();
  const userCount = await prisma.user.count();

  console.log('This will permanently delete:');
  console.log(`  - ${movementCount} movement record(s) (all ENTRY/EXIT taps and corrections)`);
  console.log(`  - ${emailCount} email log(s) (test EMAIL DETAILS sends)`);
  console.log(`  - ${auditCount} audit log entr(y/ies) for the above (${ACTIONS_TO_CLEAR.join(', ')})`);
  console.log('');
  console.log(`Left untouched: ${employeeCount} employee(s), ${userCount} user account(s), all roles/permissions/settings.`);

  if (!confirmed) {
    console.log('\nDry run only — nothing was deleted. Re-run with --confirm to actually delete.');
    await prisma.$disconnect();
    return;
  }

  // Order matters: audit_logs has no FK to movement_records/email_logs (its
  // entityId is a plain Int, not a real foreign key), so it can go first or
  // last safely. movement_records' self-referencing correctionOfId FK is
  // fine to clear in one deleteMany — Postgres checks FK constraints after
  // the whole statement completes, not row-by-row, so deleting every row
  // in one DELETE never trips over the self-reference.
  const deletedAudit = await prisma.auditLog.deleteMany({ where: { action: { in: ACTIONS_TO_CLEAR } } });
  const deletedMovements = await prisma.movementRecord.deleteMany({});
  const deletedEmails = await prisma.emailLog.deleteMany({});

  console.log('\nDone:');
  console.log(`  - Deleted ${deletedMovements.count} movement record(s)`);
  console.log(`  - Deleted ${deletedEmails.count} email log(s)`);
  console.log(`  - Deleted ${deletedAudit.count} audit log entr(y/ies)`);
  console.log(
    '\nNote: any PNG/PDF report files already uploaded to S3/R2 for those emails are NOT deleted by this script — only the database rows pointing to them. They are harmless orphaned objects, not a data-integrity issue.',
  );

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
