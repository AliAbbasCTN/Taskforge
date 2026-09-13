import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * WHAT: A catch-all exception filter applied globally in `main.ts`.
 *
 * WHY: Without this, an unexpected error (e.g. a bug, a database hiccup)
 * would either crash the process or let NestJS's default handler leak
 * internal details (stack traces, raw error messages) back to the client.
 * This filter guarantees every error response - expected (like a thrown
 * `NotFoundException`) or unexpected (an uncaught bug) - has the exact same
 * shape described in `docs/api-conventions.md`, and never exposes internals
 * outside of the server logs.
 *
 * WHERE: Registered once in `main.ts` via `app.useGlobalFilters(...)`.
 *
 * HOW: NestJS routes every unhandled exception thrown anywhere in the app
 * through this filter. `HttpException`s (thrown deliberately by our code,
 * e.g. `throw new NotFoundException('Project not found')`) carry their own
 * status and message. Anything else is treated as an unexpected 500 and
 * logged server-side with full detail, while the client only ever sees a
 * generic, safe message.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const statusCode = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = isHttpException
      ? exception.getResponse()
      : 'Internal server error';

    if (!isHttpException) {
      // Unexpected errors are logged with full detail server-side only.
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const errorBody =
      typeof message === 'string'
        ? { statusCode, message, error: HttpStatus[statusCode] ?? 'Error' }
        : { statusCode, ...(message as Record<string, unknown>) };

    response.status(statusCode).json({
      ...errorBody,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
