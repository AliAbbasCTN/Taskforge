import { ApiProperty } from '@nestjs/swagger';
import { MembershipRole, TeamRole } from '@prisma/client';
import {
  EXAMPLE_DATE,
  EXAMPLE_JWT,
  EXAMPLE_MEMBERSHIP_ID,
  EXAMPLE_ORG_ID,
  EXAMPLE_USER_ID,
} from './examples';

/**
 * RESPONSE MODELS describe what the API SENDS. They are documentation only -
 * no controller returns an instance of these classes, and nothing validates
 * against them at runtime. (The request side is different: DTOs are both the
 * validation rules AND the documentation.) Because nothing forces a response
 * model to match reality, `test/docs.e2e-spec.ts` checks real responses
 * against them.
 *
 * Dates are typed `string`: JSON has no date type, so on the wire they are
 * ISO-8601 strings.
 */

export class UserResponse {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_USER_ID })
  id!: string;

  @ApiProperty({ example: 'ada@example.com' })
  email!: string;

  @ApiProperty({ example: 'Ada Lovelace' })
  name!: string;

  @ApiProperty({ type: String, format: 'date-time', example: EXAMPLE_DATE })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', example: EXAMPLE_DATE })
  updatedAt!: string;
}

export class AuthTokensResponse {
  @ApiProperty({
    example: EXAMPLE_JWT,
    description:
      'Short-lived JWT (15 minutes by default). Send it as `Authorization: Bearer <token>`.',
  })
  accessToken!: string;

  @ApiProperty({
    example: EXAMPLE_JWT,
    description:
      'Long-lived JWT (7 days by default). Only ever sent to `POST /auth/refresh`. Single-use: every refresh returns a NEW pair and invalidates this one.',
  })
  refreshToken!: string;
}

export class AuthResponse {
  @ApiProperty({ type: UserResponse })
  user!: UserResponse;

  @ApiProperty({ type: AuthTokensResponse })
  tokens!: AuthTokensResponse;
}

export class OrganizationResponse {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_ORG_ID })
  id!: string;

  @ApiProperty({ example: 'Acme Inc.' })
  name!: string;

  @ApiProperty({
    example: 'acme-inc',
    description: 'URL-safe identifier derived from the name. Never changes.',
  })
  slug!: string;

  @ApiProperty({ type: String, format: 'date-time', example: EXAMPLE_DATE })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', example: EXAMPLE_DATE })
  updatedAt!: string;
}

export class OrganizationWithRoleResponse extends OrganizationResponse {
  @ApiProperty({
    enum: MembershipRole,
    enumName: 'MembershipRole',
    example: MembershipRole.ADMIN,
    description: 'YOUR role in this organization.',
  })
  role!: MembershipRole;
}

export class OrganizationMemberResponse {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_MEMBERSHIP_ID })
  membershipId!: string;

  @ApiProperty({
    enum: MembershipRole,
    enumName: 'MembershipRole',
    example: MembershipRole.MEMBER,
  })
  role!: MembershipRole;

  @ApiProperty({ type: String, format: 'date-time', example: EXAMPLE_DATE })
  joinedAt!: string;

  @ApiProperty({ type: UserResponse })
  user!: UserResponse;
}

export class TeamResponse {
  @ApiProperty({ format: 'uuid', example: 'a7b8c9d0-e1f2-4a3b-8c4d-5e6f7a8b9c08' })
  id!: string;

  @ApiProperty({ format: 'uuid', example: EXAMPLE_ORG_ID })
  organizationId!: string;

  @ApiProperty({ example: 'Engineering' })
  name!: string;

  @ApiProperty({ type: String, format: 'date-time', example: EXAMPLE_DATE })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', example: EXAMPLE_DATE })
  updatedAt!: string;
}

export class TeamMemberResponse {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_MEMBERSHIP_ID })
  membershipId!: string;

  @ApiProperty({
    enum: TeamRole,
    enumName: 'TeamRole',
    example: TeamRole.LEAD,
  })
  role!: TeamRole;

  @ApiProperty({ type: String, format: 'date-time', example: EXAMPLE_DATE })
  joinedAt!: string;

  @ApiProperty({ type: UserResponse })
  user!: UserResponse;
}
