import { Body, Controller, Post, Get, UseGuards, Req, Res, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { LocalAuthGuard } from './local-auth.guard';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { AuthService } from './auth.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CompletePasswordResetDto, ForgotPasswordDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // Rate-limited to blunt brute-force login attempts (spec §44).
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(200)
  async login(@Req() req: Request, @CurrentUser() user: any) {
    await this.authService.logLogin(user.id, req.ip, req.headers['user-agent']);
    return { user };
  }

  @UseGuards(SessionAuthGuard)
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response, @CurrentUser() user: any) {
    await this.authService.logLogout(user.id, req.ip, req.headers['user-agent']);
    return new Promise((resolve) => {
      req.logout(() => {
        req.session.destroy(() => {
          res.clearCookie('adage.sid');
          resolve({ success: true });
        });
      });
    });
  }

  @UseGuards(SessionAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: any) {
    return { user };
  }

  // Same rate limit as login — this is the other endpoint that accepts
  // arbitrary attacker input (an email address) with no auth required, so
  // it needs the same brute-force/abuse blunting.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    await this.authService.requestPasswordReset(dto.email, req.ip, req.headers['user-agent'] as string);
    // Always the same response whether or not the email matched an
    // account — never let this endpoint be used to enumerate accounts.
    return { message: 'If that email address is registered, a password reset link has been sent.' };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() dto: CompletePasswordResetDto, @Req() req: Request) {
    await this.authService.completePasswordReset(dto.token, dto.newPassword, req.ip, req.headers['user-agent'] as string);
    return { message: 'Password updated. You can now log in.' };
  }
}
