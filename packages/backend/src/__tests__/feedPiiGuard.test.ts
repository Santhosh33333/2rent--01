import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The personal-data rule used to be enforced only where two people talk to
 * each other (1:1 messages, group chat, chat-request notes, event threads).
 * A feed post or a comment is read by far more people than any DM, so the
 * same contact detail belonged there too — refused the same way, with the
 * same code, so the web shows one message everywhere.
 *
 * Guard placement follows the event-thread decision: authorisation first,
 * refusal second. A stranger probing a post learns nothing from the answer,
 * and a member who could have posted anyway gets the rule.
 *
 * Every refusal here is paired with an acceptance on the same path: a guard
 * that blocks ordinary text is not a guard, it is an outage.
 */

const prismaMock = vi.hoisted(() => ({
  post: { create: vi.fn(), findUnique: vi.fn() },
  postComment: { create: vi.fn() },
  friendship: { findMany: vi.fn() },
  user: { findUnique: vi.fn() },
  notification: { create: vi.fn(), createMany: vi.fn() },
  community: { findUnique: vi.fn() },
  communityMember: { findUnique: vi.fn(), findMany: vi.fn() },
  communityPost: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
  communityComment: { create: vi.fn() },
}));

vi.mock('../config/database', () => ({ prisma: prismaMock }));

import {
  createPost as createFeedPost,
  createComment as createFeedComment,
} from '../controllers/socialPostController';
import {
  createPost as createCommunityPost,
  createComment as createCommunityComment,
} from '../controllers/communityPostController';
import { PERSONAL_DATA_ERROR_CODE, PERSONAL_DATA_ERROR_MESSAGE } from '../services/piiGuard';

const ME = 'user-me-11111111';
const OTHER = 'user-other-22222222';
const COMMUNITY = 'community-1';
const FEED_POST = 'post-1';
const COMMUNITY_POST = 'cpost-1';

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}
function body(res: any) {
  return res.json.mock.calls[res.json.mock.calls.length - 1][0];
}

/** The refusal every one of these paths must produce, word for word. */
function expectRefused(res: any) {
  expect(res.status).toHaveBeenCalledWith(403);
  const payload = body(res);
  expect(payload.success).toBe(false);
  expect(payload.error).toBe(PERSONAL_DATA_ERROR_CODE);
  expect(payload.message).toBe(PERSONAL_DATA_ERROR_MESSAGE);
}

function req(body_: unknown, params: Record<string, string> = {}) {
  return { body: body_, params, user: { userId: ME } } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Community membership: an ordinary member of a non-official community.
  prismaMock.community.findUnique.mockResolvedValue({
    id: COMMUNITY,
    ownerId: OTHER,
    name: 'Chess Club',
    isOfficial: false,
    privacy: 'PUBLIC',
  });
  prismaMock.communityMember.findUnique.mockResolvedValue({
    communityId: COMMUNITY,
    userId: ME,
    role: 'MEMBER',
  });
  prismaMock.communityMember.findMany.mockResolvedValue([]);
  // Self-authored target in the notification path: no fan-out to assert against.
  prismaMock.communityPost.findUnique.mockResolvedValue({ authorId: ME, communityId: COMMUNITY });
  prismaMock.notification.create.mockResolvedValue({});
  prismaMock.notification.createMany.mockResolvedValue({ count: 0 });
});

describe('feed posts — personal-data guard', () => {
  it('refuses a contact detail before the row is written', async () => {
    const res = makeRes();
    await createFeedPost(req({ content: 'Email me at jane@example.com instead.' }), res);

    expectRefused(res);
    expect(prismaMock.post.create).not.toHaveBeenCalled();
  });

  it('publishes ordinary text', async () => {
    prismaMock.post.create.mockResolvedValue({ id: FEED_POST, content: 'Sunset ride along the lake.' });

    const res = makeRes();
    await createFeedPost(req({ content: 'Sunset ride along the lake.' }), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prismaMock.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: 'Sunset ride along the lake.' }),
      }),
    );
  });
});

describe('feed comments — personal-data guard', () => {
  beforeEach(() => {
    // Someone else's public post: canView passes with no friendship lookup.
    prismaMock.post.findUnique.mockResolvedValue({
      id: FEED_POST,
      authorId: OTHER,
      status: 'ACTIVE',
      visibility: 'PUBLIC',
    });
    prismaMock.postComment.create.mockResolvedValue({ id: 'c1', content: 'Nice shot!', parentId: null });
  });

  it('refuses a handle in a comment before the row is written', async () => {
    const res = makeRes();
    await createFeedComment(req({ content: 'add me @jane_doe on here' }, { id: FEED_POST }), res);

    expectRefused(res);
    expect(prismaMock.postComment.create).not.toHaveBeenCalled();
  });

  it('accepts an ordinary comment', async () => {
    const res = makeRes();
    await createFeedComment(req({ content: 'Great set last night.' }, { id: FEED_POST }), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prismaMock.postComment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ content: 'Great set last night.' }) }),
    );
  });
});

describe('community posts — personal-data guard', () => {
  it('refuses a phone number before the row is written', async () => {
    const res = makeRes();
    await createCommunityPost(req({ content: 'Ring me on 98765 43210 to join.' }, { id: COMMUNITY }), res);

    expectRefused(res);
    expect(prismaMock.communityPost.create).not.toHaveBeenCalled();
  });

  it('publishes ordinary text to the community', async () => {
    prismaMock.communityPost.create.mockResolvedValue({ id: COMMUNITY_POST, content: 'Weekly chess round Sunday.' });

    const res = makeRes();
    await createCommunityPost(req({ content: 'Weekly chess round on Sunday.' }, { id: COMMUNITY }), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prismaMock.communityPost.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: 'Weekly chess round on Sunday.' }),
      }),
    );
  });
});

describe('community comments — personal-data guard', () => {
  beforeEach(() => {
    prismaMock.communityPost.findFirst.mockResolvedValue({ id: COMMUNITY_POST });
    prismaMock.communityComment.create.mockResolvedValue({ id: 'cc1', content: 'Good point.', parentId: null });
  });

  it('refuses a bare domain before the row is written', async () => {
    const res = makeRes();
    await createCommunityComment(
      req({ content: 'Full bracket at chessclub.in for details' }, { id: COMMUNITY, postId: COMMUNITY_POST }),
      res,
    );

    expectRefused(res);
    expect(prismaMock.communityComment.create).not.toHaveBeenCalled();
  });

  it('accepts an ordinary comment', async () => {
    const res = makeRes();
    await createCommunityComment(
      req({ content: 'Good point about the opening.' }, { id: COMMUNITY, postId: COMMUNITY_POST }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prismaMock.communityComment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ content: 'Good point about the opening.' }) }),
    );
  });
});
