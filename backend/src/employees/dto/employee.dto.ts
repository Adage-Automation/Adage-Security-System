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
  phone?: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsString()
  designation?: string;
}

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  employeeName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
