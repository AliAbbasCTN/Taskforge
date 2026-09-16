import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  // Exported so future modules can reuse user lookups - Phase 03's
  // AuthModule will need `findByEmail` during login.
  exports: [UsersService],
})
export class UsersModule {}
