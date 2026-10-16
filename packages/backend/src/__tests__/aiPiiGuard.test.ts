import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The personal-data rule has two jobs: keep contact details away from other
 * people, and keep them away from third parties. Every AI endpoint here
 * forwards the caller's text to a model provider, so a phone number typed
 * into the assistant leaves the app entirely — a leak the chat guard would
 * have stopped one surface earlier.
 *
 * So these endpoints get the exact same refusal as chat (one wording, one
 * code, one `getErrorMessage` on the web), and the assertions prove it fires
 * *before* any work: no user lookup for the assistant, no provider call for
 * translate/draft, no agent turn for the agent. Refusing after the tokens are
 * spent would protect nobody.
 *
 * As in feedPiiGuard, every refusal is paired with a clean-text acceptance.
 */

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  event: { findMany: vi.fn() },
}));

const aiGatewayMock = vi.hoisted(() => ({
  aiComplete: vi.fn(),
  aiChat: vi.fn(),
  aiProvider: vi.fn(),
  aiConfigInfo: vi.fn(),
  checkAiQuota: vi.fn(),
}));

const agentServiceMock = vi.hoisted(() => ({ runAgentTurn: vi.fn() }));

vi.mock('../config/database', () => ({ prisma: prismaMock }));
// aiController reaches config/env through utils/demo, and the agent controller
// pulls the rbac/session helpers that do the same. Neither is under test, so
// both get the same minimal env the other suites use.
vi.mock('../config/env', () => ({
  env: { NODE_ENV: 'test', JWT_SECRET: 'test-secret', ADMIN_EMAIL: '' },
}));
vi.mock('../services/aiGateway', () => aiGatewayMock);
vi.mock('../agent/agentService', () => ({ runAgentTurn: agentServiceMock.runAgentTurn }));

import { askAssistant, translateMessage, draftText } from '../controllers/aiController';
import { agentAsk } from '../controllers/agentController';
import { PERSONAL_DATA_ERROR_CODE, PERSONAL_DATA_ERROR_MESSAGE } from '../services/piiGuard';

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}
function body(res: any) {
  return res.json.mock.calls[res.json.mock.calls.length - 1][0];
}
function expectRefused(res: any) {
  expect(res.status).toHaveBeenCalledWith(403);
  const payload = body(res);
  expect(payload.success).toBe(false);
  expect(payload.error).toBe(PERSONAL_DATA_ERROR_CODE);
  expect(payload.message).toBe(PERSONAL_DATA_ERROR_MESSAGE);
}

function reqFor(body_: unknown) {
  return {
    body: body_,
    params: {},
    query: {},
    headers: {},
    ip: '127.0.0.1',
    user: { userId: 'user-1', role: 'USER', activeRole: 'USER' },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  aiGatewayMock.aiComplete.mockResolvedValue({ text: 'A drafted line.', model: 'test-model', cached: false });
  aiGatewayMock.aiConfigInfo.mockReturnValue({ requiredEnv: ['AI_API_KEY'] });
  aiGatewayMock.checkAiQuota.mockReturnValue(null);
  agentServiceMock.runAgentTurn.mockResolvedValue({ reply: 'All set.' });
  prismaMock.user.findUnique.mockResolvedValue({ city: null });
  prismaMock.event.findMany.mockResolvedValue([]);
});

describe('assistant question — personal-data guard', () => {
  it('refuses a phone number before any lookup happens', async () => {
    const res = makeRes();
    await askAssistant(reqFor({ message: 'My number is 98765 43210, match me' }), res);

    expectRefused(res);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.event.findMany).not.toHaveBeenCalled();
  });

  it('answers an ordinary question from live data', async () => {
    const res = makeRes();
    await askAssistant(reqFor({ message: 'anything to do this week' }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = body(res);
    expect(payload.success).toBe(true);
    expect(payload.data.intent).toBe('events');
    expect(prismaMock.event.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('translation — personal-data guard', () => {
  it('refuses an email address without calling the provider', async () => {
    const res = makeRes();
    await translateMessage(reqFor({ text: 'write to jane@example.com for details', targetLang: 'hi' }), res);

    expectRefused(res);
    expect(aiGatewayMock.aiComplete).not.toHaveBeenCalled();
  });

  it('translates ordinary text', async () => {
    const res = makeRes();
    await translateMessage(reqFor({ text: 'hello friend', targetLang: 'hi' }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(aiGatewayMock.aiComplete).toHaveBeenCalledTimes(1);
    expect(body(res).data.translated).toBe('A drafted line.');
  });
});

describe('drafting help — personal-data guard', () => {
  it('refuses a phone number without calling the provider', async () => {
    const res = makeRes();
    await draftText(reqFor({ kind: 'bio', context: 'Reach me at 9876543210 any time' }), res);

    expectRefused(res);
    expect(aiGatewayMock.aiComplete).not.toHaveBeenCalled();
  });

  it('drafts from ordinary context', async () => {
    const res = makeRes();
    await draftText(reqFor({ kind: 'bio', context: 'Lover of late-night walks and live music.' }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(body(res).success).toBe(true);
    expect(aiGatewayMock.aiComplete).toHaveBeenCalledTimes(1);
  });
});

describe('agent chat — personal-data guard', () => {
  it('refuses before the agent turn, so no tokens are spent on it', async () => {
    const res = makeRes();
    await agentAsk(reqFor({ message: 'whatsapp me at 9876543210' }), res);

    expectRefused(res);
    expect(agentServiceMock.runAgentTurn).not.toHaveBeenCalled();
  });

  it('runs an ordinary turn and echoes the session', async () => {
    const res = makeRes();
    await agentAsk(reqFor({ message: 'what events are on' }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = body(res);
    expect(payload.success).toBe(true);
    expect(payload.data.sessionId).toBe('agent_user-1');
    expect(agentServiceMock.runAgentTurn).toHaveBeenCalledTimes(1);
  });
});
