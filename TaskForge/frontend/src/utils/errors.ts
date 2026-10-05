import { ApiError } from '../services/http';

/**
 * Turns anything thrown into a sentence a person can read. Errors from the
 * API already carry a readable message; anything else (a bug in our own code)
 * gets a generic message rather than leaking technical text into the UI.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}
