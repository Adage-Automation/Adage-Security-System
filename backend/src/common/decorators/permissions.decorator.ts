import { SetMetadata } from '@nestjs/common';
import { Permission } from '../constants/permissions';

export const PERMISSIONS_KEY = 'permissions';

// Every state-changing/read-sensitive endpoint declares the permission(s)
// it requires. In v1 all roles hold every permission (see spec §3), but
// the check always runs server-side so narrowing later needs no rewrite
// of individual controllers — never gate access by hiding UI alone.
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
