import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';

function context(user: unknown) {
  return {
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

describe('PermissionsGuard', () => {
  it('allows a user with every required permission', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(['RECORD_ENTRY', 'RECORD_EXIT']) } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    expect(guard.canActivate(context({ permissions: ['RECORD_ENTRY', 'RECORD_EXIT'] }))).toBe(true);
  });

  it('rejects a user missing any required permission', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(['MANAGE_USERS']) } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    expect(() => guard.canActivate(context({ permissions: ['VIEW_DASHBOARD'] }))).toThrow(ForbiddenException);
  });

  it('allows routes without permission metadata', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) } as unknown as Reflector;
    expect(new PermissionsGuard(reflector).canActivate(context({ permissions: [] }))).toBe(true);
  });
});
