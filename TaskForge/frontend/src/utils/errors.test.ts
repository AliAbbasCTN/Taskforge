import { describe, expect, it } from 'vitest';
import { ApiError } from '../services/http';
import { getErrorMessage } from './errors';

describe('getErrorMessage', () => {
  it('shows API errors as-is', () => {
    expect(getErrorMessage(new ApiError(409, 'Already a member'))).toBe(
      'Already a member',
    );
  });

  it('hides technical text from unexpected errors', () => {
    expect(getErrorMessage(new TypeError("Cannot read properties of undefined"))).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
