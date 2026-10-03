import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { TeamGuard } from './guards/team.guard';
import { TeamPermissionGuard } from './guards/team-permission.guard';
import { OrganizationMembershipGuard } from '../organizations/guards/organization-membership.guard';

/**
 * WHY `OrganizationMembershipGuard` is re-registered here as its own
 * provider, rather than importing the whole `OrganizationsModule`: it's a
 * small, stateless guard (its only dependency is `PrismaService`, which is
 * globally available). Registering the same guard CLASS as a provider in
 * both `OrganizationsModule` and `TeamsModule` reuses the exact same code
 * with zero coupling between the two feature modules - `TeamsModule`
 * doesn't need to know anything about `OrganizationsModule`'s internals,
 * or import controllers/services it has no use for.
 */
@Module({
  imports: [UsersModule],
  controllers: [TeamsController],
  providers: [
    TeamsService,
    OrganizationMembershipGuard,
    TeamGuard,
    TeamPermissionGuard,
  ],
})
export class TeamsModule {}
