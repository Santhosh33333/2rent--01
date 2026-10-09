import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, sendBetaMock } = vi.hoisted(() => ({
  prismaMock: {
    formSubmission: {
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
  sendBetaMock: vi.fn(),
}));

vi.mock("../config/database", () => ({ prisma: prismaMock }));
vi.mock("../services/emailService", () => ({
  sendEmail: vi.fn(),
  sendBetaTesterConfirmationEmail: sendBetaMock,
}));

import { capture, sendBetaInvites, remove } from "../controllers/formSubmissionController";

type MockRes = {
  statusCode: number;
  payload: any;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
};

function makeRes(): MockRes {
  const out: MockRes = {
    statusCode: 0,
    payload: null,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.payload = b;
      return this;
    },
  };
  return out;
}

function rows(...emails: Array<{ email: string; name?: string }>) {
  return emails.map((e, i) => ({
    email: e.email,
    name: e.name ?? null,
    createdAt: new Date(2026, 0, 1, 0, 0, i),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.formSubmission.updateMany.mockResolvedValue({ count: 1 });
});

describe("sendBetaInvites backfill", () => {
  it("invites each unique tester once and stamps them", async () => {
    prismaMock.formSubmission.findMany
      .mockResolvedValueOnce(rows({ email: "a@x.com" }, { email: "a@x.com" }, { email: "b@x.com" }))
      .mockResolvedValueOnce([]);
    prismaMock.formSubmission.count.mockResolvedValue(0);
    sendBetaMock.mockResolvedValue({ ok: true, provider: "brevo", messageId: "m1" });

    const out = makeRes();
    await sendBetaInvites({} as never, out as never);

    expect(out.statusCode).toBe(200);
    expect(out.payload.data).toMatchObject({ total: 2, alreadyInvited: 0, sent: 2, failed: 0 });
    expect(sendBetaMock).toHaveBeenCalledTimes(2);
    expect(prismaMock.formSubmission.updateMany).toHaveBeenCalledTimes(2);
    // The tester query must match the stored "Beta tester" case-insensitively.
    expect(prismaMock.formSubmission.findMany.mock.calls[0][0].where.form).toEqual({
      equals: "beta tester",
      mode: "insensitive",
    });
  });

  it("skips addresses that were already invited", async () => {
    prismaMock.formSubmission.findMany
      .mockResolvedValueOnce(rows({ email: "a@x.com" }, { email: "b@x.com" }))
      .mockResolvedValueOnce([{ email: "a@x.com" }]);
    prismaMock.formSubmission.count.mockResolvedValue(0);
    sendBetaMock.mockResolvedValue({ ok: true, provider: "brevo" });

    const out = makeRes();
    await sendBetaInvites({} as never, out as never);

    expect(out.payload.data).toMatchObject({ total: 2, alreadyInvited: 1, sent: 1, failed: 0 });
    expect(sendBetaMock).toHaveBeenCalledTimes(1);
    expect(sendBetaMock).toHaveBeenCalledWith("b@x.com", "b@x.com");
  });

  it("does not stamp an address when delivery fails", async () => {
    prismaMock.formSubmission.findMany
      .mockResolvedValueOnce(rows({ email: "a@x.com" }, { email: "b@x.com" }))
      .mockResolvedValueOnce([]);
    prismaMock.formSubmission.count.mockResolvedValue(0);
    sendBetaMock.mockResolvedValue({ ok: false, provider: "brevo", error: "EMAIL_DELIVERY_FAILED" });

    const out = makeRes();
    await sendBetaInvites({} as never, out as never);

    expect(out.statusCode).toBe(502);
    expect(out.payload.error).toBe("EMAIL_DELIVERY_FAILED");
    expect(prismaMock.formSubmission.updateMany).not.toHaveBeenCalled();
  });
});

describe("capture fires the beta invite", () => {
  it("emails a brand-new beta applicant", async () => {
    prismaMock.formSubmission.create.mockResolvedValue({ id: "fs1" });
    prismaMock.formSubmission.count.mockResolvedValue(0);
    sendBetaMock.mockResolvedValue({ ok: true, provider: "brevo" });

    const req = {
      body: { Form: "Beta tester", email: "new@x.com", Name: "New" },
      ip: "1.2.3.4",
      headers: {},
    } as never;
    const out = makeRes();
    await capture(req, out as never);

    expect(out.statusCode).toBe(201);
    await vi.waitFor(() => expect(sendBetaMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(prismaMock.formSubmission.updateMany).toHaveBeenCalledTimes(1));
  });

  it("does not re-email an applicant who already has an invite", async () => {
    prismaMock.formSubmission.create.mockResolvedValue({ id: "fs2" });
    prismaMock.formSubmission.count.mockResolvedValue(1);

    const req = {
      body: { Form: "Beta tester", email: "again@x.com", Name: "Again" },
      ip: "1.2.3.4",
      headers: {},
    } as never;
    const out = makeRes();
    await capture(req, out as never);

    expect(out.statusCode).toBe(201);
    await new Promise((r) => setTimeout(r, 10));
    expect(sendBetaMock).not.toHaveBeenCalled();
    expect(prismaMock.formSubmission.updateMany).not.toHaveBeenCalled();
  });
});

describe("remove form reply", () => {
  it("deletes an existing row", async () => {
    prismaMock.formSubmission.deleteMany.mockResolvedValue({ count: 1 });
    const out = makeRes();
    await remove({ params: { id: "row-1" } } as never, out as never);

    expect(out.statusCode).toBe(200);
    expect(out.payload.data).toMatchObject({ id: "row-1", deleted: 1 });
    expect(prismaMock.formSubmission.deleteMany).toHaveBeenCalledWith({ where: { id: "row-1" } });
  });

  it("404s for a missing row", async () => {
    prismaMock.formSubmission.deleteMany.mockResolvedValue({ count: 0 });
    const out = makeRes();
    await remove({ params: { id: "gone" } } as never, out as never);

    expect(out.statusCode).toBe(404);
    expect(out.payload.error).toBe("FORM_NOT_FOUND");
  });

  it("400s without an id", async () => {
    const out = makeRes();
    await remove({ params: {} } as never, out as never);

    expect(out.statusCode).toBe(400);
    expect(out.payload.error).toBe("FORM_ID_REQUIRED");
  });
});
