import { SetMetadata } from '@nestjs/common';
import { Permission } from './permission.enum';

export const PERMISSION_METADATA_KEY = 'requiredPermission';

/**
 * WHAT: A decorator that declares which `Permission` a route requires,
 * without the route handler itself containing any authorization logic.
 *
 * WHY this pattern (metadata + a guard that reads it via `Reflector`),
 * rather than checking permissions inline inside each controller method:
 * this is NestJS's standard, idiomatic way to build RBAC, and it keeps the
 * "what does this route require" declaration sitting directly on the route
 * (readable at a glance) while the "how do we check that" logic lives in
 * exactly one place (`OrganizationPermissionGuard` /
 * `TeamPermissionGuard`), not copy-pasted into every handler.
 *
 * WHERE: Applied above a route method, alongside `@UseGuards(...)`:
 *
 *   @Patch(':id')
 *   @RequirePermission(Permission.OrganizationManage)
 *   @UseGuards(OrganizationMembershipGuard, OrganizationPermissionGuard)
 *   update(...) { ... }
 *
 * The corresponding guard reads this metadata off the route handler at
 * request time via `Reflector.get(PERMISSION_METADATA_KEY, handler)`.
 */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_METADATA_KEY, permission);
