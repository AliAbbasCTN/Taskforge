import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

/**
 * WHAT: Wires together everything authentication needs.
 *
 * WHY `JwtModule.registerAsync`: the access-token secret and expiry come
 * from `ConfigService`, which itself depends on environment variables that
 * are only available once `ConfigModule` has loaded. The async form lets us
 * inject `ConfigService` to build the JWT module's options, rather than
 * reading `process.env` directly here.
 *
 * NOTE: `JwtModule` is configured here with the ACCESS token secret only.
 * Refresh tokens are signed and verified manually inside `AuthService`
 * using `configService.get('jwt.refreshSecret')`, because they use a
 * different secret and Nest's JwtModule only holds one default
 * configuration at a time. Two secrets, one static (access) and one used
 * dynamically (refresh), is simpler here than registering two full JWT
 * module instances for a single service.
 */
@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.accessSecret'),
        signOptions: {
          expiresIn: configService.get<string>('jwt.accessExpiresIn'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
})
export class AuthModule {}
