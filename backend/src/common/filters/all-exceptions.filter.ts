import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import * as Sentry from '@sentry/node';

// Spec §62 asks for backend error logging across DB failures, auth
// failures, report-generation failures, and unexpected errors — this was
// previously nonexistent outside two services that happened to add their
// own Logger calls (email/reports). Registered globally in main.ts so
// every uncaught exception, from any module, is logged consistently with
// enough context to actually debug a production incident, and never
// leaks a raw stack trace to the client (spec §62's other requirement).
// Found in the 2026-09-09 audit.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('UnhandledException');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = isHttpException
      ? exception.getResponse()
      : { statusCode: status, message: 'Internal server error' };

    // Expected 4xx (validation, not-found, forbidden, etc.) are routine —
    // only log at warn/error for anything that isn't a normal client error,
    // to keep signal-to-noise usable.
    const logPayload = {
      method: request.method,
      path: request.originalUrl,
      status,
      userId: (request as any).user?.id,
    };
    if (status >= 500) {
      this.logger.error(`${request.method} ${request.originalUrl} -> ${status}`, exception instanceof Error ? exception.stack : String(exception));
      // No-ops safely if SENTRY_DSN was never set (main.ts) — only a
      // genuine 500 is worth reporting, not routine 4xx client errors.
      Sentry.captureException(exception, { extra: logPayload });
    } else if (status >= 400) {
      this.logger.warn(`${request.method} ${request.originalUrl} -> ${status}: ${JSON.stringify(logPayload)}`);
    }

    response.status(status).json(
      typeof message === 'object' ? message : { statusCode: status, message },
    );
  }
}
