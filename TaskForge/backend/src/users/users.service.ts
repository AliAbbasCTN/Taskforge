import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';

/**
 * The fields of a User that are safe to send to a client. `passwordHash`
 * and `hashedRefreshToken` are deliberately excluded here - not filtered out
 * afterwards, but never selected from the database in the first place for
 * these queries. That distinction matters: a field that's never fetched
 * cannot accidentally leak through a bug in some later serialization step.
 */
export const SAFE_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type SafeUser = Prisma.UserGetPayload<{
  select: typeof SAFE_USER_SELECT;
}>;

/** Input for creating a user with an already-hashed password. Deliberately
 * not a public DTO - the only caller is AuthService.register(), which is
 * responsible for hashing the plaintext password before it ever reaches
 * this service. */
export interface CreateUserInput {
  email: string;
  name: string;
  passwordHash: string;
}

/**
 * WHAT: Business logic for user records, backed by PostgreSQL via Prisma.
 *
 * WHERE: Injected into `UsersController`, `AuthController`, `AuthService`,
 * and `OrganizationsService`.
 *
 * A note on error handling: Prisma throws low-level database errors with
 * codes like `P2002` (unique constraint violated) and `P2025` (record not
 * found). Those are database concepts, not HTTP concepts. This service
 * translates them into the correct HTTP exceptions (409 Conflict, 404 Not
 * Found) so callers never have to know Prisma exists.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * WHAT: Fetches a user's profile, but ONLY if the requester is allowed to
   * see it - either it's their own profile, or they share at least one
   * organization with the target user.
   *
   * WHY this changed in Phase 04: before organizations existed, "any
   * logged-in user can view any other user's basic profile" was a
   * reasonable, low-risk default. Now that TaskForge is multi-tenant, that
   * same behaviour would let a member of Organization A look up the profile
   * of any user in Organization B - a real tenant-isolation leak, not a
   * hypothetical one. This method is the fix: it enforces "shared
   * organization or self" as a precondition for every profile read.
   *
   * WHY 404, not 403: telling an unauthorized requester "403 Forbidden"
   * confirms the user ID exists at all. Returning the same 404 as a
   * genuinely nonexistent ID reveals nothing extra - consistent with how
   * cross-tenant resource lookups are handled everywhere else in this app.
   */
  async findOne(id: string, requestingUserId: string): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: SAFE_USER_SELECT,
    });

    if (!user) {
      throw new NotFoundException(`User with id ${id} not found`);
    }

    if (id !== requestingUserId) {
      const shareOrg = await this.shareAnyOrganization(id, requestingUserId);
      if (!shareOrg) {
        throw new NotFoundException(`User with id ${id} not found`);
      }
    }

    return user;
  }

  private async shareAnyOrganization(
    userIdA: string,
    userIdB: string,
  ): Promise<boolean> {
    const membershipsA = await this.prisma.membership.findMany({
      where: { userId: userIdA },
      select: { organizationId: true },
    });

    if (membershipsA.length === 0) {
      return false;
    }

    const organizationIds = membershipsA.map((m) => m.organizationId);

    const sharedMembership = await this.prisma.membership.findFirst({
      where: { userId: userIdB, organizationId: { in: organizationIds } },
      select: { id: true },
    });

    return sharedMembership !== null;
  }

  /**
   * Used ONLY by AuthService during login, where the password hash is
   * genuinely needed to verify credentials. Every other caller must use
   * `findOne`, which never fetches this field.
   */
  async findByEmailForAuth(email: string): Promise<{
    id: string;
    email: string;
    name: string;
    passwordHash: string;
  } | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, passwordHash: true },
    });
  }

  /**
   * Used by OrganizationsService when inviting a member by email - it needs
   * to look up an existing account by email, but only ever the safe,
   * public fields (never the password hash).
   */
  async findByEmailSafe(email: string): Promise<SafeUser | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: SAFE_USER_SELECT,
    });
  }

  /**
   * Used ONLY by AuthService while validating a refresh token, where the
   * stored hash is genuinely needed for comparison.
   */
  async findByIdWithRefreshHash(id: string): Promise<{
    id: string;
    email: string;
    hashedRefreshToken: string | null;
  } | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, hashedRefreshToken: true },
    });
  }

  /**
   * Creates a user from an already-hashed password. This is intentionally
   * not exposed via any public DTO/controller route - account creation
   * happens exclusively through `POST /auth/register`, which owns password
   * hashing before calling this.
   */
  async create(input: CreateUserInput): Promise<SafeUser> {
    try {
      return await this.prisma.user.create({
        data: input,
        select: SAFE_USER_SELECT,
      });
    } catch (error) {
      throw this.translatePrismaError(error, input.email);
    }
  }

  async update(id: string, dto: UpdateUserDto): Promise<SafeUser> {
    try {
      return await this.prisma.user.update({
        where: { id },
        data: dto,
        select: SAFE_USER_SELECT,
      });
    } catch (error) {
      throw this.translatePrismaError(error, id);
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.prisma.user.delete({ where: { id } });
    } catch (error) {
      throw this.translatePrismaError(error, id);
    }
  }

  /**
   * Stores a new hashed refresh token for a user, or clears it (on logout)
   * by passing `null`. Not exposed through any DTO - only AuthService calls
   * this, as part of the login/refresh/logout flow.
   */
  async setRefreshTokenHash(
    id: string,
    hashedRefreshToken: string | null,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { hashedRefreshToken },
    });
  }

  private translatePrismaError(error: unknown, identifier: string): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002 = unique constraint violation - here that can only mean the
      // email is already registered. We rely on the database constraint
      // rather than a "check if exists, then insert" in application code,
      // because that pattern has a race condition: two simultaneous
      // requests could both pass the check and both try to insert.
      if (error.code === 'P2002') {
        return new ConflictException('A user with this email already exists');
      }
      // P2025 = the record to update/delete was not found.
      if (error.code === 'P2025') {
        return new NotFoundException(`User with id ${identifier} not found`);
      }
    }
    return error as Error;
  }
}
