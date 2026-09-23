import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * WHAT: The validated shape of a request body for `PATCH /organizations/:id`.
 *
 * WHY the slug isn't updatable here: an organization's slug is meant to be
 * a stable identifier once created. If it were used in URLs or shared
 * links later, changing it silently would break them. Renaming the
 * organization's display name doesn't need to change its slug.
 */
export class UpdateOrganizationDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(150)
  name!: string;
}
