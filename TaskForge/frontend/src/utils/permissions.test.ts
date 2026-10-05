import { describe, expect, it } from 'vitest';
import { canManageProject, canWriteTasks, hasOrgOversight } from './permissions';

describe('UI permission hints (mirror the backend rules; the server still decides)', () => {
  it('org ADMIN and MANAGER oversee everything; MEMBER does not', () => {
    expect(hasOrgOversight('ADMIN')).toBe(true);
    expect(hasOrgOversight('MANAGER')).toBe(true);
    expect(hasOrgOversight('MEMBER')).toBe(false);
    expect(hasOrgOversight(undefined)).toBe(false);
  });

  it('only a project LEAD or org oversight can manage a project', () => {
    expect(canManageProject('MEMBER', 'LEAD')).toBe(true);
    expect(canManageProject('MEMBER', 'MEMBER')).toBe(false);
    expect(canManageProject('MEMBER', null)).toBe(false);
    expect(canManageProject('MANAGER', null)).toBe(true);
  });

  it('any project member or org oversight can write tasks', () => {
    expect(canWriteTasks('MEMBER', 'MEMBER')).toBe(true);
    expect(canWriteTasks('MEMBER', 'LEAD')).toBe(true);
    expect(canWriteTasks('MEMBER', null)).toBe(false);
    expect(canWriteTasks('ADMIN', null)).toBe(true);
  });
});
