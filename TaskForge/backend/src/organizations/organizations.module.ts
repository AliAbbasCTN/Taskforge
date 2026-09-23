import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { OrganizationMembershipGuard } from './guards/organization-membership.guard';
import { OrganizationAdminGuard } from './guards/organization-admin.guard';

@Module({
  imports: [UsersModule],
  controllers: [OrganizationsController],
  providers: [
    OrganizationsService,
    OrganizationMembershipGuard,
    OrganizationAdminGuard,
  ],
})
export class OrganizationsModule {}
