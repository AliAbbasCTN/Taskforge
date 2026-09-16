import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

/**
 * WHAT: Business logic for user records, backed by PostgreSQL via Prisma.
 *
 * WHY this replaces the Phase 01 `ExampleService`: that service stored data
 * in an in-memory array, so everything vanished on restart. This one
 * persists to a real database, and demonstrates the same controller ->
 * service -> DI pattern against real infrastructure.
 *
 * WHERE: Injected into `UsersController`.
 *
 * A note on error handling: Prisma throws low-level database errors with
 * codes like `P2002` (unique constraint violated) and `P2025` (record not
 * found). Those are database concepts, not HTTP concepts. This service
 * translates them into the correct HTTP exceptions (409 Conflict, 404 Not
 * Found) so the controller never has to know Prisma exists, and clients get
 * meaningful status codes.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<User[]> {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with id ${id} not found`);
    }

    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async create(dto: CreateUserDto): Promise<User> {
    try {
      return await this.prisma.user.create({
        data: {
          email: dto.email,
          name: dto.name,
        },
      });
    } catch (error) {
      // P2002 = unique constraint violation. Here that can only mean the
      // email is already registered.
      //
      // We rely on the database constraint rather than doing a "check if
      // exists, then insert" in application code, because that check-then-act
      // pattern has a race condition: two simultaneous requests could both
      // pass the check and both try to insert. The database's unique index
      // is the only reliable guard.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('A user with this email already exists');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    try {
      return await this.prisma.user.update({
        where: { id },
        data: dto,
      });
    } catch (error) {
      // P2025 = "record to update not found".
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException(`User with id ${id} not found`);
      }
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.prisma.user.delete({ where: { id } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException(`User with id ${id} not found`);
      }
      throw error;
    }
  }
}
