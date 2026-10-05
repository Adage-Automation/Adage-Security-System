import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateEmployeeDto {
  @IsString()
  @MinLength(1)
  employeeCode: string;

  @IsString()
  @MinLength(1)
  employeeName: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  carNumber?: string;
}

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  employeeName?: string;

  // string | null, not just string | undefined — `undefined` (the key
  // omitted entirely) means "leave this field as it is," while `null`
  // means "clear it." Both email and carNumber are optional fields that
  // can legitimately be set once and later need removing (a mistyped
  // email, a sold car) — without this distinction there was no way to
  // actually clear either field via Edit: Prisma treats an `undefined`
  // value as "field not provided" and silently leaves the old value in
  // place, so a frontend that collapsed a blank input to `undefined`
  // looked like it saved (200 OK) but had no effect. @IsOptional() skips
  // every other validator (including @IsEmail()) for both `null` and
  // `undefined`, so a `null` clear-request never hits @IsEmail(). Found
  // in the 2026-10-05 Employees-page audit.
  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  carNumber?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
