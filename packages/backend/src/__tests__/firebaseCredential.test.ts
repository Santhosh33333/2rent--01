import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockCert, mockGetApps, mockInitializeApp } = vi.hoisted(() => {
  const apps: any[] = [];
  return {
    mockCert: vi.fn((sa: any) => ({ credential: "cert", sa })),
    mockGetApps: vi.fn(() => apps),
    mockInitializeApp: vi.fn((cfg: any) => {
      const app = { name: "DEFAULT", options: cfg };
      apps.push(app);
      return app;
    }),
  };
});

vi.mock('firebase-admin/app', () => ({
  cert: mockCert,
  getApps: mockGetApps,
  initializeApp: mockInitializeApp,
}));

import { getOrCreateFirebaseApp, loadFirebaseServiceAccount } from '../services/firebaseCredential';

const LEAKED_KEY_ID = 'e290c0108e874735bea19fd1be0228b22c8f4124';

function serviceAccount(overrides: Record<string, any> = {}) {
  return {
    type: 'service_account',
    project_id: 'nabri-9b94d',
    private_key_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
    client_email: 'firebase-adminsdk@nabri-9b94d.iam.gserviceaccount.com',
    ...overrides,
  };
}

let apps: any[];

beforeEach(() => {
  apps = [];
  mockGetApps.mockImplementation(() => apps);
  mockInitializeApp.mockImplementation((cfg: any) => {
    const app = { name: 'DEFAULT', options: cfg };
    apps.push(app);
    return app;
  });
  mockCert.mockClear();
  mockInitializeApp.mockClear();
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
});

afterEach(() => {
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
});

describe('loadFirebaseServiceAccount', () => {
  it('returns null when the variable is not set, so features degrade quietly', () => {
    expect(loadFirebaseServiceAccount()).toBeNull();
  });

  it('parses a valid single-line service account', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify(serviceAccount());
    expect(loadFirebaseServiceAccount()?.project_id).toBe('nabri-9b94d');
  });

  it('rejects the exposed key that must not be used again', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify(
      serviceAccount({ private_key_id: LEAKED_KEY_ID }),
    );
    expect(() => loadFirebaseServiceAccount()).toThrow(/REVOKED key/);
    expect(() => loadFirebaseServiceAccount()).toThrow(LEAKED_KEY_ID);
  });

  it('rejects malformed JSON with actionable guidance', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = '{not json';
    expect(() => loadFirebaseServiceAccount()).toThrow(/not valid JSON/);
  });

  it('rejects a service account missing required fields', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'x' });
    expect(() => loadFirebaseServiceAccount()).toThrow(/missing required field/);
  });
});

describe('getOrCreateFirebaseApp', () => {
  it('returns null when Firebase is not configured', () => {
    expect(getOrCreateFirebaseApp()).toBeNull();
  });

  it('creates the default app once and reuses it afterwards', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify(serviceAccount());

    const first = getOrCreateFirebaseApp();
    const second = getOrCreateFirebaseApp();

    // The second call must reuse, not re-initialise: Firebase throws on a
    // duplicate default app, which is what silently disabled push before.
    expect(mockInitializeApp).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('reuses an app registered by another service', () => {
    // Simulate firebaseAuthService having initialised first.
    const preRegistered = { name: 'DEFAULT', options: { credential: 'from-auth' } };
    apps.push(preRegistered);
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify(serviceAccount());

    expect(getOrCreateFirebaseApp()).toBe(preRegistered);
    expect(mockInitializeApp).not.toHaveBeenCalled();
  });

  it('refuses to start on the revoked credential', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify(
      serviceAccount({ private_key_id: LEAKED_KEY_ID }),
    );
    expect(() => getOrCreateFirebaseApp()).toThrow(/REVOKED key/);
    expect(mockInitializeApp).not.toHaveBeenCalled();
  });
});
