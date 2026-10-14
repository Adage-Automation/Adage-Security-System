import { Injectable } from '@nestjs/common';
import { PassportSerializer } from '@nestjs/passport';
import { AuthService } from './auth.service';

// Only the user id is stored in the session cookie; permissions/role are
// re-hydrated from the DB on every request via deserializeUser, so a
// role/permission change (or deactivation) takes effect immediately
// without waiting for the session to expire.
@Injectable()
export class SessionSerializer extends PassportSerializer {
  constructor(private authService: AuthService) {
    super();
  }

  serializeUser(user: any, done: (err: Error | null, id?: number) => void) {
    done(null, user.id);
  }

  async deserializeUser(id: number, done: (err: Error | null, user?: any) => void) {
    try {
      const user = await this.authService.findAuthenticatedUserById(id);
      if (!user) {
        return done(null, false as any);
      }
      done(null, user);
    } catch (err) {
      // deserializeUser runs on every authenticated request, outside
      // Nest's normal controller/exception-filter pipeline (Passport's
      // session middleware calls it ahead of any route handler) — a DB
      // hiccup here (connectivity loss, connection-pool exhaustion) was
      // previously an unhandled rejection that crashed the ENTIRE backend
      // process, not just this one request. Confirmed twice in production:
      // a Supabase connectivity drop, then a Prisma connection-pool
      // timeout (2026-10-14) — see docs/decisions.md. Passing the error to
      // `done` instead lets it surface as a normal failed request (caught
      // by AllExceptionsFilter) for the user to retry, while every other
      // request keeps being served.
      done(err as Error);
    }
  }
}
