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
  phone?: string | null;
  department?: string | null;
  designation?: string | null;
  carNumber?: string | null;
  isActive: boolean;
}

export type MovementType = 'ENTRY' | 'EXIT';

export interface MovementRecord {
  id: number;
  employeeId: number;
  movementType: MovementType;
  movementAt: string;
  recordedByUserId: number;
  employee?: { id: number; employeeName: string; employeeCode: string };
  recordedBy?: { id: number; name: string };
}

export interface CreateMovementResponse {
  created: boolean;
  requiresConfirmation: boolean;
  lastMovementType?: MovementType;
  record?: MovementRecord;
}
