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
const SAFE_USER_SELECT = {
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
 * WHERE: Injected into `UsersController` and `AuthService`.
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

  async findAll(): Promise<SafeUser[]> {
    return this.prisma.user.findMany({
      select: SAFE_USER_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: SAFE_USER_SELECT,
    });

    if (!user) {
      throw new NotFoundException(`User with id ${id} not found`);
    }

    return user;
  }

  /**
   * Used ONLY by AuthService during login, where the password hash is
   * genuinely needed to verify credentials. Every other caller must use
   * `findOne`/`findAll`, which never fetch this field.
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
