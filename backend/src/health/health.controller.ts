import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Deliberately public (no SessionAuthGuard) — used for two things that both
// need to reach it without a session: (1) the frontend's "is the server
// actually reachable, not just the network link" check (see
// frontend/src/api/health.ts — closes the gap flagged in the 2026-09-21
// audit where navigator.onLine alone can't tell a dead backend/DB from a
// fine one), and (2) an external uptime pinger (cron-job.org, UptimeRobot,
// GitHub Actions schedule) hitting this on a few-minute interval to stop
// Render's free tier from spinning the backend down after 15 minutes idle.
// A trivial DB round trip is included so the same ping also keeps
// Supabase's project from auto-pausing after a week of no activity —
// one endpoint serves both keep-alive needs.
@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Database unreachable');
    }
    return { status: 'ok', time: new Date().toISOString() };
  }
}
