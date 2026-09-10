import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import session from 'express-session';
import passport from 'passport';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  // Nest's default logger prints every module's dependency init
  // (InstanceLoader) and every single route it registers (RouterExplorer/
  // RoutesResolver) on every boot — none of that is actionable day to day.
  // Keep only warnings and errors; our own "listening on port ..." line
  // below (a plain console.log, unaffected by this) still confirms boot.
  if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET must be configured in production.');
  }
  const app = await NestFactory.create(AppModule, { logger: ['warn', 'error'] });

  // Without this, req.ip returns the reverse proxy's own address on every
  // PaaS this app is meant to deploy to (Railway/Render/Fly.io) — breaking
  // both audit-log IP capture and per-IP rate limiting (which would key
  // every user off the same proxy IP, one bad actor locking out everyone).
  // Only trust the immediate hop, not the whole X-Forwarded-For chain.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.use(helmet());
  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    credentials: true,
  });

  // Session store backed by Postgres (not memory) so sessions survive
  // restarts/multiple instances. Cookie is httpOnly + secure in
  // production — never rely on hiding UI for security (spec §44).
  const PgSession = connectPgSimple(session);
  const pgPool = new Pool({ connectionString: process.env.DATABASE_URL });

  app.use(
    session({
      store: new PgSession({ pool: pgPool, tableName: 'session', createTableIfMissing: true }),
      name: 'adage.sid',
      secret: process.env.SESSION_SECRET ?? 'dev-secret-change-me',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 12, // 12 hours
      },
    }),
  );

  app.use(passport.initialize());
  app.use(passport.session());

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.setGlobalPrefix('api');

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  console.log(`Adage Security System backend listening on port ${port}`);
}

bootstrap();
