import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension, ApiForbiddenResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from '../swagger/error-response.dto';
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
 *
 * PHASE 16: the same declaration now also DOCUMENTS the route. It adds a 403
 * response and an `x-required-permission` extension to the OpenAPI document,
 * so the permission shown in Swagger is the one the guard enforces - there is
 * no second place to keep up to date, and so nothing that can drift.
 */
export const RequirePermission = (permission: Permission) =>
  applyDecorators(
    SetMetadata(PERMISSION_METADATA_KEY, permission),
    ApiExtension('x-required-permission', permission),
    ApiForbiddenResponse({
      description: `Forbidden - requires the \`${permission}\` permission.`,
      type: ErrorResponseDto,
    }),
  );
