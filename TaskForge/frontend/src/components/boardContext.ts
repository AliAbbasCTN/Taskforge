import type { MembershipRole } from '../types/api';

/**
 * WHAT: What the board page shares with the task panel that opens on top of
 * it (via React Router's `<Outlet context>` / `useOutletContext`).
 *
 * WHY context instead of letting the panel recompute it: the page already
 * worked out the columns and what the current user may do. Passing it down
 * means the panel can't disagree with the board about, say, whether the
 * project is archived.
 */
export interface BoardOutletContext {
  columns: { id: string; name: string }[];
  /** May create and edit tasks (and the project is not archived). */
  canWrite: boolean;
  /** May moderate - delete other people's comments (and not archived). */
  canModerate: boolean;
  archived: boolean;
  orgRole: MembershipRole | undefined;
}
