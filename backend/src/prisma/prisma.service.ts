import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

function withConnectionLimit(databaseUrl: string | undefined): string | undefined {
  if (!databaseUrl) {
    return undefined;
  }

  const url = new URL(databaseUrl);
  if (!url.searchParams.has('connection_limit')) {
    url.searchParams.set('connection_limit', '8');
  }
  return url.toString();
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const url = withConnectionLimit(process.env.DATABASE_URL);
    super(url ? { datasources: { db: { url } } } : {});
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
