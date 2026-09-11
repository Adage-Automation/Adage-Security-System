import 'fake-indexeddb/auto';
import {
  enqueueMovement,
  listPendingMovements,
  removePendingMovement,
  updatePendingMovement,
} from './movementQueue';

describe('movementQueue', () => {
  beforeEach(async () => {
    const entries = await listPendingMovements();
    await Promise.all(entries.map((entry) => removePendingMovement(entry.localId)));
  });

  it('queues, lists, and removes a pending movement', async () => {
    const pending = await enqueueMovement({
      clientRequestId: 'tap-1',
      userId: 3,
      employeeId: 7,
      employeeName: 'Test Employee',
      movementType: 'ENTRY',
      confirmed: false,
    });

    await expect(listPendingMovements()).resolves.toEqual([pending]);
    await removePendingMovement(pending.localId);
    await expect(listPendingMovements()).resolves.toEqual([]);
  });

  it('preserves the client request id for retry idempotency', async () => {
    const pending = await enqueueMovement({
      clientRequestId: 'same-tap',
      userId: 3,
      employeeId: 7,
      employeeName: 'Test Employee',
      movementType: 'EXIT',
    });

    expect(pending.clientRequestId).toBe('same-tap');
    expect(pending.queuedAt).toEqual(expect.any(String));
  });

  it('stores conflict metadata for queued records that need review', async () => {
    const pending = await enqueueMovement({
      clientRequestId: 'conflict-tap',
      userId: 3,
      employeeId: 7,
      employeeName: 'Test Employee',
      movementType: 'ENTRY',
      confirmed: false,
    });

    await updatePendingMovement(pending.localId, {
      syncState: 'conflict',
      conflictReason: 'A newer movement already exists for this employee.',
    });

    await expect(listPendingMovements()).resolves.toEqual([
      expect.objectContaining({
        localId: pending.localId,
        syncState: 'conflict',
        conflictReason: 'A newer movement already exists for this employee.',
      }),
    ]);
  });
});
