import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { RealtimeAccessService } from './realtime-access.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeInterceptor } from './realtime.interceptor';
import { RealtimeService } from './realtime.service';

/**
 * `@Global()` so any module can inject `RealtimeService` without importing
 * this one - the same reason `DatabaseModule` is global. It imports
 * `AuthModule` only for the `JwtService` the gateway uses to verify tokens
 * with the SAME secret as the HTTP side.
 *
 * `APP_INTERCEPTOR` registers the interceptor for the whole application (it
 * still does nothing unless a route opts in with a decorator).
 */
@Global()
@Module({
  imports: [AuthModule],
  providers: [
    RealtimeGateway,
    RealtimeService,
    RealtimeAccessService,
    { provide: APP_INTERCEPTOR, useClass: RealtimeInterceptor },
  ],
  exports: [RealtimeService],
})
export class RealtimeModule {}
