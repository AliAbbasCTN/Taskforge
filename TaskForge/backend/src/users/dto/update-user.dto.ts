import { IsOptional, IsString, IsNotEmpty, MaxLength } from 'class-validator';

/**
 * WHAT: The validated shape of a request body for `PATCH /users/:id`.
 *
 * WHY every field is optional: `PATCH` semantics mean "update only the
 * fields I send", unlike `PUT` which replaces the whole resource. A client
 * updating just the name shouldn't have to resend the email.
 *
 * WHY email isn't updatable here: changing an account's email address is a
 * security-sensitive operation that should require verifying the new
 * address and re-authenticating. That belongs with the authentication work
 * in Phase 03, not with basic profile updates - so it is deliberately
 * excluded rather than quietly allowed.
 *
 * WHERE: `UsersController.update()`.
 */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;
}
