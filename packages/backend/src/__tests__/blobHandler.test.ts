import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Uploaded media is served from the API origin but embedded by the web app and
 * the Capacitor shell, which run on a different origin. helmet() sets
 * Cross-Origin-Resource-Policy: same-origin on every response, and the browser
 * then silently refuses to render the <img> even though the bytes arrived - the
 * upload "succeeds" and the picture never appears. The handler must override
 * that for served uploads. These tests pin the override so a future helmet or
 * handler change cannot quietly reintroduce the bug.
 */

const { readBlobMock } = vi.hoisted(() => ({ readBlobMock: vi.fn() }));

vi.mock("../services/blobStorage", () => ({ readBlob: readBlobMock }));

import { blobFileHandler } from "../middleware/blobHandler";

function makeRes() {
  const headers: Record<string, string> = {};
  const res: any = {
    headers,
    ended: false,
    setHeader(k: string, v: string) { headers[k.toLowerCase()] = v; },
    end() { this.ended = true; },
  };
  return res;
}

function makeErrorRes() {
  const res: any = {
    statusCode: 0,
    body: null,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; },
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.body = b; return this; },
    end() { /* no-op */ },
  };
  return res;
}

describe("blobFileHandler", () => {
  beforeEach(() => readBlobMock.mockReset());

  it("lets any origin embed a public upload", async () => {
    readBlobMock.mockResolvedValue({
      key: "a.png", filename: "a.png", mimeType: "image/png", size: 3, data: Buffer.from("abc"),
    });
    const res = makeRes();

    await blobFileHandler({ path: "/a.png" } as never, res as never);

    expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.ended).toBe(true);
  });

  it("keeps private KYC media out of shared caches while still overridable cross-origin", async () => {
    readBlobMock.mockResolvedValue({
      key: "private/x.png", filename: "x.png", mimeType: "image/png", size: 3, data: Buffer.from("abc"),
    });
    const res = makeRes();

    await blobFileHandler({ path: "/private/x.png" } as never, res as never);

    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
  });

  it("404s a missing file instead of throwing", async () => {
    readBlobMock.mockResolvedValue(null);
    const res = makeErrorRes();

    await blobFileHandler({ path: "/nope.png" } as never, res as never);

    expect(res.statusCode).toBe(404);
  });
});
