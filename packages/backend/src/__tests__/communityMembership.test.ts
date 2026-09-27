import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards the community join/leave toggle.
 *
 * The backend always populated `isMember`, so the field was never the problem.
 * The toggle broke because the two read paths computed it *differently* (the
 * list forced it true for the owner, the detail did not), the responses
 * carried no membership state to reconcile against, and the list page wrote
 * the whole array back from a captured snapshot while only one row was
 * disabled at a time. The result was a button that re-failed forever, or two
 * quick taps that silently undid each other.
 *
 * web has no test runner, so these are structural guards in the backend suite.
 */

const REPO = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(REPO, p), 'utf8');

const ctrl = read('packages/backend/src/controllers/communityController.ts');

describe('community membership is reported consistently', () => {
  it('does not force isMember true for the owner in the list', () => {
    // `isMember: mineSet.has(item.id) || item.ownerId === userId` made the list
    // render "Leave" for an owner whose member row did not exist. The client
    // then chose /leave forever, the API 404'd NOT_MEMBER, and the UI could
    // never show "Join" again.
    expect(ctrl).toMatch(/isMember:\s*mineSet\.has\(item\.id\)/);
    expect(ctrl).not.toMatch(/isMember:\s*mineSet\.has\(item\.id\)\s*\|\|/);
  });

  it('derives isMember the same way in both read paths', () => {
    // Detail used `!!isMember` from a membership lookup. Keep the list on the
    // same truth: the presence of the CommunityMember row.
    expect(ctrl).toMatch(/isMember:\s*!!isMember/);
  });

  it('keeps isOwner independent of isMember', () => {
    expect(ctrl).toMatch(/isOwner:\s*item\.ownerId === req\.user!\.userId/);
    expect(ctrl).toMatch(/isOwner:\s*community\.ownerId === req\.user!\.userId/);
  });
});

describe('join and leave return the settled state', () => {
  it('returns isMember and memberCount on join', () => {
    // `sendSuccess(res, undefined, ...)` produced a body with no `data` key at
    // all, so the client had no server truth and could only guess.
    const start = ctrl.indexOf('export async function joinCommunity');
    const body = ctrl.slice(start, ctrl.indexOf('export async function', start + 10));
    expect(body).toMatch(/isMember:\s*true/);
    expect(body).toMatch(/memberCount/);
    expect(body).not.toMatch(/sendSuccess\(res,\s*undefined/);
  });

  it('returns isMember and memberCount on leave', () => {
    const start = ctrl.indexOf('export async function leaveCommunity');
    const body = ctrl.slice(start, ctrl.indexOf('export async function', start + 10));
    expect(body).toMatch(/isMember:\s*false/);
    expect(body).toMatch(/memberCount/);
    expect(body).not.toMatch(/sendSuccess\(res,\s*undefined/);
  });

  it('counts members from the rows, not the drifted column', () => {
    const start = ctrl.indexOf('export async function joinCommunity');
    const body = ctrl.slice(start, ctrl.indexOf('export async function', start + 10));
    expect(body).toMatch(/communityMember\.count\(\{\s*where:\s*\{\s*communityId: id\s*\}\s*\}\)/);
  });

  it('creates the community and its owner membership atomically', () => {
    // The row (memberCount: 1) and the owner CommunityMember used to be two
    // separate writes, so a failure between them left a community claiming one
    // member with zero member rows. Reads recompute the count, but search and
    // the AI assistant read the column.
    const start = ctrl.indexOf('export async function createCommunity');
    const body = ctrl.slice(start, ctrl.indexOf('export async function', start + 10));
    expect(body).toMatch(/prisma\.\$transaction\(async \(tx\) =>/);
    expect(body).toMatch(/tx\.community\.create/);
    expect(body).toMatch(/tx\.communityMember\.create/);
  });
});

describe('the client reconciles instead of overwriting from a snapshot', () => {
  const list = read('packages/web/src/pages/communities/CommunitiesPage.tsx');
  const detail = read('packages/web/src/pages/communities/CommunityDetailPage.tsx');

  it('uses a functional list update on toggle', () => {
    // `setList(list.map(...))` replaced the whole array from the array captured
    // in the click closure, so two overlapping toggles each erased the other.
    expect(list).toMatch(/setList\(prev => prev\.map\(/);
    expect(list).not.toMatch(/setList\(list\.map\(/);
  });

  it('allows concurrent toggles and disables only the row in flight', () => {
    expect(list).toMatch(/useState<string\[\]>\(\[\]\)/);
    expect(list).toMatch(/joining\.includes\(community\.id\)/);
    expect(list).not.toMatch(/joining === community\.id/);
  });

  it('prefers the server state over a blind local flip', () => {
    expect(list).toMatch(/typeof settled\.isMember === 'boolean'/);
    expect(list).toMatch(/Number\.isFinite\(Number\(settled\.memberCount\)\)/);
  });

  it('clears a previous refresh error and ignores stale responses', () => {
    // `error` was set but never reset and the render guards on
    // `error || !community`, so one failed sub-request permanently replaced a
    // working page with "Failed to Load".
    expect(detail).toMatch(/setError\(null\)/);
    expect(detail).toMatch(/refreshSeq/);
    expect(detail).toMatch(/seq !== refreshSeq\.current/);
  });

  it('re-reads the server after a rejected toggle', () => {
    expect(detail).toMatch(/catch \(e: any\) \{[\s\S]{0,400}await refresh\(\)/);
  });

  it('warns a sole owner that they cannot leave', () => {
    // leaveCommunity 400s while the viewer is the only ADMIN, which is the
    // normal state right after creating a community.
    expect(detail).toMatch(/community\.isMember && community\.isOwner/);
  });
});
