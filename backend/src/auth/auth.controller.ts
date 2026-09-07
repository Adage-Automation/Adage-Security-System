import { Controller, Post, Get, UseGuards, Req, Res, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { LocalAuthGuard } from './local-auth.guard';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { AuthService } from './auth.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

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
}
