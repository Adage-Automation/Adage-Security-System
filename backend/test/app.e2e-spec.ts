import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import helmet from 'helmet';
import session from 'express-session';
import passport from 'passport';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const runE2e = Boolean(process.env.E2E_TEST_DATABASE_URL);
const describeE2e = runE2e ? describe : describe.skip;

describeE2e('application HTTP e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let employeeCode: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.E2E_TEST_DATABASE_URL;
    process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'e2e-only-secret';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(helmet());
    app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false }));
    app.use(passport.initialize());
    app.use(passport.session());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (employeeCode) await prisma.employee.deleteMany({ where: { employeeCode } });
    await app.close();
  });

  it('rejects protected requests without a session', async () => {
    await request(app.getHttpServer()).get('/api/employees').expect(401);
  });

  it('logs in, enforces RBAC, and manages an employee over HTTP', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ username: 'admin', password: 'ChangeMe123!' }).expect(200);

    const forbidden = request.agent(app.getHttpServer());
    await forbidden.post('/api/auth/login').send({ username: 'security', password: 'ChangeMe123!' }).expect(200);
    await forbidden.get('/api/users').expect(403);

    employeeCode = `E2E-${Date.now()}`;
    const created = await agent.post('/api/employees').send({
      employeeCode,
      employeeName: 'E2E Employee',
      email: 'e2e@example.com',
      carNumber: 'E2E-1234',
    }).expect(201);

    expect(created.body.employeeCode).toBe(employeeCode);
    await agent.get(`/api/employees/search?q=${employeeCode}`).expect(200);
    await agent.put(`/api/employees/${created.body.id}`).send({ carNumber: 'E2E-5678' }).expect(200);
  });

  it('returns the same movement for an idempotent retry', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ username: 'admin', password: 'ChangeMe123!' }).expect(200);
    const employee = await prisma.employee.findFirst({ where: { employeeCode: employeeCode } });
    const clientRequestId = `e2e-${Date.now()}`;

    const first = await agent.post('/api/movements').send({ employeeId: employee!.id, movementType: 'ENTRY', clientRequestId }).expect(201);
    const replay = await agent.post('/api/movements').send({ employeeId: employee!.id, movementType: 'ENTRY', clientRequestId }).expect(201);
    expect(replay.body.record.id).toBe(first.body.record.id);
  });
});
