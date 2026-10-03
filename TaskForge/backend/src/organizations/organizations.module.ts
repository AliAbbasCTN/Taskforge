import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { OrganizationMembershipGuard } from './guards/organization-membership.guard';
import { OrganizationPermissionGuard } from './guards/organization-permission.guard';

@Module({
  imports: [UsersModule],
  controllers: [OrganizationsController],
  providers: [
    OrganizationsService,
    OrganizationMembershipGuard,
    OrganizationPermissionGuard,
  ],
})
export class OrganizationsModule {}
