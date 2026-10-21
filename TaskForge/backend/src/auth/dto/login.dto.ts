import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

/**
 * WHAT: The validated shape of a request body for `POST /auth/login`.
 *
 * WHY no length/complexity rules on password here (unlike RegisterDto): this
 * DTO validates a login attempt, not a new password. Rejecting a login
 * attempt for "too short" would leak information about password rules to
 * an attacker for no benefit - we just need *some* string to compare.
 */
export class LoginDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  @ApiProperty({ example: 'ada@example.com' })
  email!: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ example: 'password1', format: 'password' })
  password!: string;
}
