import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * WHAT: The validated shape of a request body for `POST /organizations`.
 *
 * WHY there's no `slug` field: the slug is derived from `name` server-side
 * (see `slugify()` in `common/utils/slugify.ts`). Letting the client supply
 * an arbitrary slug directly would mean validating it for URL-safety and
 * uniqueness ourselves anyway - deriving it is simpler and guarantees it's
 * always consistent with the name that was actually submitted.
 */
export class CreateOrganizationDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(150)
  name!: string;
}
