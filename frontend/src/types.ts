export interface AuthUser {
  id: number;
  name: string;
  email: string;
  username: string;
  role: string;
  permissions: string[];
}

export interface Employee {
  id: number;
  employeeCode: string;
  employeeName: string;
  email: string | null;
  carNumber?: string | null;
  team?: string | null;
  isActive: boolean;
}

export type MovementType = 'ENTRY' | 'EXIT';

export interface MovementRecord {
  id: number;
  employeeId: number;
  movementType: MovementType;
  movementAt: string;
  recordedByUserId: number;
  // True when movementAt came from the guard's device (offline-queue sync)
  // instead of the server clock — see docs/decisions.md.
  recordedOffline?: boolean;
  employee?: { id: number; employeeName: string; employeeCode: string };
  recordedBy?: { id: number; name: string };
  // Set only when this record was backfilled via Missing Movements
  // (addMissingRecord), never for a real-time guard tap — see AddedBadge.
  correctedByUserId?: number | null;
  correctedBy?: { id: number; name: string } | null;
  correctionReason?: string | null;
}

export interface CreateMovementResponse {
  created: boolean;
  requiresConfirmation: boolean;
  lastMovementType?: MovementType;
  lastMovementAt?: string;
  record?: MovementRecord;
}
