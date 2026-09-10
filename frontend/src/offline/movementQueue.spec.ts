import 'fake-indexeddb/auto';
import {
  enqueueMovement,
  listPendingMovements,
  removePendingMovement,
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
});
