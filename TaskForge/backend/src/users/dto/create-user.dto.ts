import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * WHAT: The validated shape of a request body for `POST /users`.
 *
 * WHY the length limits: they mirror the database column constraints
 * (`VARCHAR(255)` for email, `VARCHAR(100)` for name) defined in
 * `prisma/schema.prisma`. Validating at the API boundary means an
 * over-long value is rejected with a clear 400 instead of reaching
 * PostgreSQL and failing with an opaque database error.
 *
 * WHERE: `UsersController.create()`.
 */
export class CreateUserDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;
}
