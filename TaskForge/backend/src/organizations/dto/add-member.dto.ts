import { IsEmail, IsEnum, IsOptional } from 'class-validator';
import { MembershipRole } from '@prisma/client';

/**
 * WHAT: The validated shape of a request body for
 * `POST /organizations/:id/members`.
 *
 * WHY email, not a user ID: the admin adding a member usually doesn't know
 * (and shouldn't need to know) another user's internal UUID - email is what
 * people actually identify each other by.
 *
 * WHY this only works for EXISTING accounts (a deliberate, temporary
 * limitation): this adds a membership for a user who has already registered
 * on TaskForge. It does not send an email invitation or create a account
 * for someone who hasn't signed up yet - that's a real feature (with email
 * delivery, pending-invite state, expiry) that deserves its own phase
 * rather than being squeezed in here. For now, adding an unregistered
 * email returns 404.
 */
export class AddMemberDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsEnum(MembershipRole)
  role?: MembershipRole;
}
