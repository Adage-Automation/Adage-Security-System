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
    const user = await this.authService.findAuthenticatedUserById(id);
    if (!user) {
      return done(null, false as any);
    }
    done(null, user);
  }
}
