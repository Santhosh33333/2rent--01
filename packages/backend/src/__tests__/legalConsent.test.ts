// The consent gate is the legal control point, so its rules are asserted
// directly: a gate must be blocked until the CURRENT version of every required
// document is signed, and an older acceptance must not silently satisfy a gate
// after the wording changes.
import { describe, it, expect, beforeAll, vi } from 'vitest';

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_ACCESS_SECRET = 'test_access_secret_32chars_minimum!';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_32chars_minimum!';
process.env.JWT_SECRET = 'test_jwt_secret_32chars_minimum_2026!';
process.env.ADMIN_EMAIL = 'test@test.com';
process.env.ADMIN_PASSWORD = 'TestPass123!';

const CURRENT_VERSION = 2;

const doc = (id: string, kind: string, title: string) => ({
  id,
  kind,
  version: CURRENT_VERSION,
  title,
  summary: 'x',
  isCurrent: true,
  contentHtml: `<h3>1. Test clause</h3><p>Wording for ${title}.</p>`,
  plainText: `1. Test clause\nWording for ${title}.`,
});

const state = {
  docs: [
    doc('doc-ua', 'USER_AGREEMENT', 'Nabri User Agreement'),
    doc('doc-pp', 'PRIVACY_POLICY', 'Nabri Privacy Policy'),
    doc('doc-cg', 'COMMUNITY_GUIDELINES', 'Nabri Community & Safety Guidelines'),
    doc('doc-bp', 'BOOKING_POLICY', 'Nabri Booking, Cancellation, Refund & Payment Policy'),
  ],
  acceptances: [] as any[],
  created: [] as any[],
};

vi.mock("../config/database", () => ({
  prisma: {
    legalDocument: {
      findMany: vi.fn(async () => state.docs),
      findFirst: vi.fn(async ({ where }: any) => {
        const d = state.docs.find((x) => x.kind === where.kind && x.isCurrent);
        return d || null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const created = { id: `doc-new-${state.docs.length}`, ...data };
        state.docs.push(created);
        return created;
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    legalAcceptance: {
      findMany: vi.fn(async ({ where }: any) =>
        state.acceptances.filter((a) => a.userId === where.userId && (!where.kind || where.kind.in.includes(a.kind))),
      ),
      findFirst: vi.fn(async ({ where }: any) =>
        state.acceptances.find((a) => a.userId === where.userId && a.documentId === where.documentId) || null,
      ),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `acc-${state.created.length + 1}`, acceptedAt: new Date(), ...data };
        state.created.push(row);
        state.acceptances.push(row);
        return row;
      }),
    },
    auditLog: { create: vi.fn(async () => ({})) },
    user: { findUnique: vi.fn(async () => ({ email: 'u@test.com', fullName: 'Test User' })) },
  },
}));

vi.mock("../config/env", () => ({
  env: { AGREEMENT_ARCHIVE_EMAILS: "admin@test.com", ADMIN_EMAIL: "admin@test.com" },
}));

vi.mock("../services/emailService", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock("../services/emailTemplate", () => ({
  renderEmail: vi.fn(() => "<html/>"),
  escHtml: (s: string) => s,
  WEB_ORIGIN: "https://nabri.test",
}));
vi.mock("../services/agreementPdf", () => ({ buildAgreementPdf: vi.fn(async () => Buffer.from("pdf")) }));

let svc: typeof import("../services/legalConsentService");
let docs: typeof import("../legal/documents");

beforeAll(async () => {
  svc = await import("../services/legalConsentService.js");
  docs = await import("../legal/documents.js");
});

describe("Required documents per gate", () => {
  it("signup requires the user agreement, privacy policy and community rules", () => {
    expect(docs.CONSENT_REQUIREMENTS.SIGNUP).toEqual([
      "USER_AGREEMENT",
      "PRIVACY_POLICY",
      "COMMUNITY_GUIDELINES",
    ]);
  });

  it("partner onboarding also requires the partner agreement", () => {
    expect(docs.CONSENT_REQUIREMENTS.PARTNER_ONBOARDING).toContain("PARTNER_AGREEMENT");
    // ...and keeps the base terms, so a partner cannot skip them by applying.
    expect(docs.CONSENT_REQUIREMENTS.PARTNER_ONBOARDING).toContain("USER_AGREEMENT");
    expect(docs.CONSENT_REQUIREMENTS.PARTNER_ONBOARDING).toContain("PRIVACY_POLICY");
  });

  it("booking requires the booking/refund policy", () => {
    expect(docs.CONSENT_REQUIREMENTS.BOOKING).toEqual(["BOOKING_POLICY"]);
  });

  it("all five documents are defined with real content, not placeholders", () => {
    expect(docs.LEGAL_DOCUMENTS).toHaveLength(5);
    for (const d of docs.LEGAL_DOCUMENTS) {
      expect(d.contentHtml.length).toBeGreaterThan(500);
      expect(d.plainText.length).toBeGreaterThan(500);
      expect(d.title).toMatch(/Nabri/);
      // The draft must carry the review warning rather than claiming to be final.
      expect(d.contentHtml).toContain("Draft for legal review");
    }
  });

  it("every document is uniquely keyed and correctly typed", () => {
    const kinds = docs.LEGAL_DOCUMENTS.map((d) => d.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds).toContain("USER_AGREEMENT");
    expect(kinds).toContain("PARTNER_AGREEMENT");
    expect(kinds).toContain("PRIVACY_POLICY");
    expect(kinds).toContain("COMMUNITY_GUIDELINES");
    expect(kinds).toContain("BOOKING_POLICY");
  });

  it("the booking policy states the 5:00 PM cutoff and the 10:00 PM limit", () => {
    const policy = docs.LEGAL_DOCUMENTS.find((d) => d.kind === "BOOKING_POLICY")!;
    expect(policy.plainText).toContain("5:00 PM");
    expect(policy.plainText).toContain("6:00 PM");
    expect(policy.plainText).toContain("10:00 PM");
  });
});

describe("Consent gate is blocked until the current version is signed", () => {
  it("a user who signed nothing cannot book", async () => {
    const status = await svc.getConsentStatus("u1", "BOOKING");
    expect(status.satisfied).toBe(false);
    expect(status.missing).toEqual(["BOOKING_POLICY"]);
  });

  it("signup is blocked with all three documents outstanding", async () => {
    const status = await svc.getConsentStatus("u1", "SIGNUP");
    expect(status.satisfied).toBe(false);
    expect(status.missing.sort()).toEqual(["COMMUNITY_GUIDELINES", "PRIVACY_POLICY", "USER_AGREEMENT"]);
  });

  it("partial consent does not open the gate", async () => {
    await svc.recordConsent({ userId: "u2", kind: "USER_AGREEMENT", signatureType: "TYPED_NAME", signatureValue: "Asha Rao", consentType: "SIGNUP" });
    const status = await svc.getConsentStatus("u2", "SIGNUP");
    expect(status.satisfied).toBe(false);
    expect(status.missing).not.toContain("USER_AGREEMENT");
    expect(status.missing).toContain("PRIVACY_POLICY");
  });

  it("the gate opens only once every required document is signed", async () => {
    await svc.recordConsent({ userId: "u3", kind: "PRIVACY_POLICY", signatureType: "TYPED_NAME", signatureValue: "Asha Rao", consentType: "SIGNUP" });
    await svc.recordConsent({ userId: "u3", kind: "COMMUNITY_GUIDELINES", signatureType: "DRAWN", signatureValue: "data:image/png;base64,AAAA", consentType: "SIGNUP" });
    await svc.recordConsent({ userId: "u3", kind: "USER_AGREEMENT", signatureType: "TYPED_NAME", signatureValue: "Asha Rao", consentType: "SIGNUP" });
    const status = await svc.getConsentStatus("u3", "SIGNUP");
    expect(status.satisfied).toBe(true);
    expect(status.missing).toEqual([]);
  });

  it("a booking policy signature does not satisfy the signup gate", async () => {
    await svc.recordConsent({ userId: "u4", kind: "BOOKING_POLICY", signatureType: "TYPED_NAME", signatureValue: "Asha Rao", consentType: "BOOKING" });
    expect((await svc.getConsentStatus("u4", "BOOKING")).satisfied).toBe(true);
    expect((await svc.getConsentStatus("u4", "SIGNUP")).satisfied).toBe(false);
  });
});

describe("Re-consent after a material change", () => {
  it("an acceptance of an older version does not satisfy the gate", async () => {
    await svc.recordConsent({ userId: "u5", kind: "USER_AGREEMENT", signatureType: "TYPED_NAME", signatureValue: "Asha Rao", consentType: "SIGNUP" });
    expect((await svc.getConsentStatus("u5", "SIGNUP")).missing).not.toContain("USER_AGREEMENT");

    // A lawyer publishes a new version: the old signature no longer binds.
    const doc = state.docs.find((d) => d.kind === "USER_AGREEMENT")!;
    doc.version = CURRENT_VERSION + 1;
    doc.id = "doc-ua-v3";

    const status = await svc.getConsentStatus("u5", "SIGNUP");
    expect(status.satisfied).toBe(false);
    expect(status.missing).toContain("USER_AGREEMENT");
    // Reported separately from a never-signed document.
    expect(status.reConsentRequired).toContain("USER_AGREEMENT");

    doc.version = CURRENT_VERSION;
    doc.id = "doc-ua";
  });
});

describe("Acceptance records are sealed and append-only", () => {
  it("stores a sha256 of the exact signed text", async () => {
    const before = state.created.length;
    await svc.recordConsent({ userId: "u6", kind: "BOOKING_POLICY", signatureType: "TYPED_NAME", signatureValue: "Asha Rao", consentType: "BOOKING" });
    const rec = state.created[before];
    expect(rec.contentSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("records the IP and user agent from the request, not the body", async () => {
    const before = state.created.length;
    await svc.recordConsent({
      userId: "u7",
      kind: "PRIVACY_POLICY",
      signatureType: "TYPED_NAME",
      signatureValue: "Asha Rao",
      consentType: "SIGNUP",
      ipAddress: "203.0.113.9",
      userAgent: "Nabri/1.0",
    });
    const rec = state.created[before];
    expect(rec.ipAddress).toBe("203.0.113.9");
    expect(rec.userAgent).toBe("Nabri/1.0");
  });

  it("is idempotent: re-signing does not create a duplicate record", async () => {
    await svc.recordConsent({ userId: "u8", kind: "USER_AGREEMENT", signatureType: "TYPED_NAME", signatureValue: "Asha Rao", consentType: "SIGNUP" });
    const after = state.created.length;
    const res = await svc.recordConsent({ userId: "u8", kind: "USER_AGREEMENT", signatureType: "TYPED_NAME", signatureValue: "Asha Rao", consentType: "SIGNUP" });
    expect(state.created).toHaveLength(after);
    expect(res.ok).toBe(true);
  });

  it("rejects an unknown document kind instead of recording nothing", async () => {
    const res = await svc.recordConsent({ userId: "u9", kind: "NOT_A_DOCUMENT", signatureType: "TYPED_NAME", signatureValue: "Asha Rao", consentType: "SIGNUP" });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("DOCUMENT_NOT_FOUND");
  });

  // Signup writes the acceptance inside the account-creation transaction, so a
  // crash or a failed consent write must not leave a live account that is bound
  // to terms nobody agreed to. That only works if recordConsent actually uses
  // the injected client rather than the shared prisma instance.
  it("writes through the injected transaction client, not the shared prisma", async () => {
    const calls: string[] = [];
    const fakeTx: any = {
      legalDocument: {
        findFirst: async ({ where }: any) => {
          calls.push("tx.legalDocument.findFirst");
          return state.docs.find((d) => d.kind === where.kind && d.isCurrent) || null;
        },
      },
      legalAcceptance: {
        findFirst: async () => null,
        create: async ({ data }: any) => {
          calls.push("tx.legalAcceptance.create");
          return { id: "acc-tx", acceptedAt: new Date(), ...data };
        },
      },
      auditLog: { create: async () => ({}) },
    };

    const res = await svc.recordConsent({
      userId: "u-atomic",
      kind: "USER_AGREEMENT",
      signatureType: "TYPED_NAME",
      signatureValue: "Asha Rao",
      consentType: "SIGNUP",
      db: fakeTx,
    });

    expect(res.ok).toBe(true);
    expect(calls).toEqual(["tx.legalDocument.findFirst", "tx.legalAcceptance.create"]);
    // The shared client must not have been touched.
    expect(state.created.some((r) => r.userId === "u-atomic")).toBe(false);
  });

  it("the SIGNUP gate covers user agreement, privacy and community guidelines", () => {
    expect(docs.CONSENT_REQUIREMENTS.SIGNUP).toEqual([
      "USER_AGREEMENT",
      "PRIVACY_POLICY",
      "COMMUNITY_GUIDELINES",
    ]);
  });

  // The route validator has always advertised RE_CONSENT as a valid
  // consentType, but CONSENT_REQUIREMENTS had no such key, so the controller
  // rejected every re-consent with a 400 and an updated-terms notice could
  // never be cleared. This pins the key to the same core terms as signup.
  it("every gate the routes accept actually exists in CONSENT_REQUIREMENTS", () => {
    for (const gate of ["SIGNUP", "PARTNER_ONBOARDING", "BOOKING", "RE_CONSENT"]) {
      expect(docs.CONSENT_REQUIREMENTS[gate], `gate ${gate} must be defined`).toBeDefined();
      expect(docs.CONSENT_REQUIREMENTS[gate].length).toBeGreaterThan(0);
    }
    expect(docs.CONSENT_REQUIREMENTS.RE_CONSENT).toEqual(docs.CONSENT_REQUIREMENTS.SIGNUP);
  });
});
