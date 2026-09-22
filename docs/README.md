# Adage Security System — Documentation Index

This folder contains the complete documentation for the Adage Security System. Start here and follow the links relevant to you.

## By audience

| Audience | Document |
|---|---|
| Security guard (day-to-day use) | [user-guide-security.md](./user-guide-security.md) |
| HR (viewing/emailing records) | [user-guide-hr.md](./user-guide-hr.md) |
| Admin (users, employees, settings) | [user-guide-admin.md](./user-guide-admin.md) |
| Developer (setup, conventions) | [developer-guide.md](./developer-guide.md) |
| Architect / technical reviewer | [architecture.md](./architecture.md) |

## Reference

- [branding-and-data-needed.md](./branding-and-data-needed.md) — exactly what Adage needs to supply (logo, brand color, real data, accounts) before production launch
- [email-m365-admin-handoff.md](./email-m365-admin-handoff.md) — exact instructions to hand to whoever administers Microsoft 365/Azure for `adage-automation.com`, to register the OAuth2 app and grant it mail-send access
- [architecture.md](./architecture.md) — system design, data flow, module layout
- [database-schema.md](./database-schema.md) — every table, field, relationship, and index
- [api-reference.md](./api-reference.md) — every REST endpoint, request/response shape, required permission
- [security.md](./security.md) — auth model, RBAC, audit logging, data-protection practices
- [testing.md](./testing.md) — what must be tested and how, per spec §63
- [deployment.md](./deployment.md) — environments, hosting options, release checklist
- [decisions.md](./decisions.md) — architecture decisions log (ADRs) — why things were built the way they were
- [roadmap.md](./roadmap.md) — task list: what's built, what's left, in priority order
- [../CHANGELOG.md](../CHANGELOG.md) — dated log of what changed in the codebase

## Project at a glance

Adage Security System replaces a manual paper register for recording when employees enter/exit company premises. A security guard searches for an employee, taps ENTRY or EXIT, and the system records the server timestamp — except for a tap recorded while offline, which keeps the guard's real device-captured time (within a bounded plausibility window) once it syncs, rather than the time it happened to reach the server. See [decisions.md](./decisions.md#offline-sync-preserve-the-real-tap-time-within-bounds). HR/Admin can browse historical records on a dashboard and, only when an employee explicitly asks, email them their movement record for a given day.

Three user roles exist — `SECURITY`, `HR`, `ADMIN` — with role-based access (narrowed from an initial flat "everyone has everything" default on 2026-09-04): Security gets the core recording workflow plus Dashboard, HR additionally gets Employees, and only Admin gets Users/Corrections/Audit Log/Settings. See [decisions.md](./decisions.md) for the mapping and rationale.

See [README.md](../README.md) in the repo root for the tech stack summary and local setup commands.
