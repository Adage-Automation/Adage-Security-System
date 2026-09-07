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
