import { MovementRecord } from '../types';

// Shown next to a movement's time wherever records are listed (same
// places OfflineBadge already appears), when that record was backfilled
// via Missing Movements (MovementsService.addMissingRecord) rather than a
// real-time guard tap — makes a record's provenance visible instead of a
// silent DB flag (`correctedByUserId`) nobody reviewing the table could
// see. Added 2026-10-26, by request, once Security (not just Admin)
// could add these.
export function AddedBadge({ record }: { record: MovementRecord }) {
  if (!record.correctedByUserId) return null;
  const who = record.correctedBy?.name ?? 'someone';
  const reason = record.correctionReason ? ` — "${record.correctionReason}"` : '';
  return (
    <span className="added-badge" title={`Added by ${who} via Missing Movements, not a live tap${reason}`}>
      added
    </span>
  );
}
