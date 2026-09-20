import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * WHAT: The validated shape of a request body for `POST /auth/register`.
 *
 * WHY the password rules: a minimum length alone still allows "aaaaaaaa".
 * Requiring at least one letter and one number is a lightweight, no-external-
 * dependency way to rule out the weakest passwords without being so strict
 * it frustrates real users (we deliberately do NOT require special
 * characters - that rule is known to push people toward predictable
 * substitutions like "Password1!" without meaningfully improving security).
 */
export class RegisterDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(72, {
    // bcrypt silently ignores anything past 72 bytes - capping the input
    // here means what the user typed is exactly what gets hashed.
    message: 'password must be at most 72 characters',
  })
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, {
    message: 'password must contain at least one letter and one number',
  })
  password!: string;
}
