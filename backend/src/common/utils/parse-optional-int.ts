import { BadRequestException } from '@nestjs/common';

// Nest's built-in ParseIntPipe({ optional: true }) was found to throw even
// when the query param is completely absent, not just when malformed
// (verified against @nestjs/common 10.4.22, 2026-09-09) — so optional
// numeric query params are parsed with this instead. A genuinely missing
// value passes through as undefined; a present-but-non-numeric value still
// fails cleanly with a 400, same intent as ParseIntPipe.
export function parseOptionalInt(value: string | undefined, paramName: string): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new BadRequestException(`Validation failed: "${paramName}" must be an integer`);
  }
  return parsed;
}
