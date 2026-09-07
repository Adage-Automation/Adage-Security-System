import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';

// Verifies the request carries an authenticated session (populated by
// passport-local + express-session on login). Every controller that isn't
// explicitly public must be guarded by this — the frontend hiding a button
// is never sufficient authorization (spec §44).
@Injectable()
export class SessionAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (request.isAuthenticated && request.isAuthenticated()) {
      return true;
    }
    throw new UnauthorizedException('Not authenticated');
  }
}
