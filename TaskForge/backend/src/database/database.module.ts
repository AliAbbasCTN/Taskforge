import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * WHAT: The module that owns TaskForge's database connection.
 *
 * WHY `@Global()`: virtually every future domain module (users,
 * organizations, projects, boards, tasks...) needs database access. Marking
 * this module global means they can inject `PrismaService` directly without
 * each one having to import `DatabaseModule` explicitly. This is one of the
 * few places where a global module is genuinely appropriate - a single
 * shared infrastructure resource, not business logic.
 *
 * WHERE: Imported once, in `app.module.ts`.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
