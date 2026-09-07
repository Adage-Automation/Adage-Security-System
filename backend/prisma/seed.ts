import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import {
  PERMISSIONS,
  ROLES,
  DEFAULT_ROLE_PERMISSIONS,
} from '../src/common/constants/permissions';

const prisma = new PrismaClient();

async function main() {
  // Roles
  const roleRecords: Record<string, { id: number }> = {};
  for (const roleName of ROLES) {
    roleRecords[roleName] = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });
  }

  // Permissions
  const permissionRecords: Record<string, { id: number }> = {};
  for (const permissionName of PERMISSIONS) {
    permissionRecords[permissionName] = await prisma.permission.upsert({
      where: { name: permissionName },
      update: {},
      create: { name: permissionName },
    });
  }

  // Role <-> Permission (v1: all roles get all permissions)
  for (const roleName of ROLES) {
    for (const permissionName of DEFAULT_ROLE_PERMISSIONS[roleName]) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: roleRecords[roleName].id,
            permissionId: permissionRecords[permissionName].id,
          },
        },
        update: {},
        create: {
          roleId: roleRecords[roleName].id,
          permissionId: permissionRecords[permissionName].id,
        },
      });
    }
  }

  // Settings
  await prisma.setting.upsert({
    where: { key: 'COMPANY_NAME' },
    update: {},
    create: { key: 'COMPANY_NAME', value: 'Adage' },
  });
  await prisma.setting.upsert({
    where: { key: 'TIMEZONE' },
    update: {},
    create: { key: 'TIMEZONE', value: 'Asia/Kolkata' },
  });
  await prisma.setting.upsert({
    where: { key: 'SECURITY_EMAIL' },
    update: {},
    create: { key: 'SECURITY_EMAIL', value: 'security@adage-automation.com' },
  });
  await prisma.setting.upsert({
    where: { key: 'EMAIL_SENDER_NAME' },
    update: {},
    create: { key: 'EMAIL_SENDER_NAME', value: 'Adage Security System' },
  });

  // Dev-only users. Passwords are dev defaults ONLY — never reuse in production.
  const devPassword = await argon2.hash('ChangeMe123!');

  const adminUser = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      name: 'Admin User',
      email: 'admin@adage.local',
      username: 'admin',
      passwordHash: devPassword,
      roleId: roleRecords.ADMIN.id,
    },
  });

  const hrUser = await prisma.user.upsert({
    where: { username: 'hr' },
    update: {},
    create: {
      name: 'HR User',
      email: 'hr@adage.local',
      username: 'hr',
      passwordHash: devPassword,
      roleId: roleRecords.HR.id,
    },
  });

  await prisma.user.upsert({
    where: { username: 'security' },
    update: {},
    create: {
      name: 'Security User',
      email: 'security.user@adage.local',
      username: 'security',
      passwordHash: devPassword,
      roleId: roleRecords.SECURITY.id,
    },
  });

  // No sample employees or movement records are seeded — real employee data
  // is imported via `npm run import:employees` (see backend/scripts/) and
  // must never be overwritten by re-running this seed script.

  console.log('Seed complete. Dev users (username / password):');
  console.log('  admin / ChangeMe123!');
  console.log('  hr / ChangeMe123!');
  console.log('  security / ChangeMe123!');
  console.log('These are development-only credentials — never use them in production.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
