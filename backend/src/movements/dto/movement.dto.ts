import { IsBoolean, IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateMovementDto {
  @IsInt()
  employeeId: number;

  @IsIn(['ENTRY', 'EXIT'])
  movementType: 'ENTRY' | 'EXIT';

  // Set by the frontend only after the guard has confirmed the duplicate-
  // movement warning (§43). The server never trusts a client-provided
  // timestamp or user identity — only this confirmation flag.
  @IsOptional()
  @IsBoolean()
  confirmed?: boolean;

  // Client-generated idempotency key, one per guard tap, reused across
  // retries of that same tap (including the offline-queue's sync retry).
  // Lets the server recognize "this exact request already succeeded" and
  // return the existing record instead of creating a duplicate — see the
  // clientRequestId field comment in schema.prisma for the failure mode
  // this closes. Optional so direct API/test callers aren't forced to
  // supply one.
  @IsOptional()
  @IsString()
  clientRequestId?: string;
}

export class CorrectMovementDto {
  @IsIn(['ENTRY', 'EXIT'])
  movementType: 'ENTRY' | 'EXIT';

  @IsInt()
  employeeId: number;

  // ISO timestamp for the corrected movement. @IsISO8601 rather than
  // @IsString — an unvalidated string reaches `new Date(...)` unchanged,
  // producing "Invalid Date" and an uncaught Prisma error (raw 500)
  // instead of a clean validation error.
  @IsISO8601()
  movementAt: string;

  // Required per the design (spec §42: every correction is accountable in
  // the audit log) — @IsString alone accepts "", silently defeating that.
  @IsString()
  @IsNotEmpty()
  correctionReason: string;
}
