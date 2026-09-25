import { describe, it, expect, vi } from "vitest";

// Re-import under a mutable env so provider selection can be exercised.
vi.resetModules();

const BASE_ENV: Record<string, string | undefined> = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  JWT_ACCESS_SECRET: "test_access_secret_32chars_minimum!",
  JWT_REFRESH_SECRET: "test_refresh_secret_32chars_minimum!",
  JWT_SECRET: "test_jwt_secret_32chars_minimum_2026!",
};

async function loadGateway(withEnv: Record<string, string | undefined>) {
  const original = { ...process.env };
  Object.keys(BASE_ENV).forEach((k) => (process.env[k] = BASE_ENV[k]));
  Object.keys(withEnv).forEach((k) => {
    if (withEnv[k] === undefined) delete process.env[k];
    else process.env[k] = withEnv[k];
  });
  try {
    vi.resetModules();
    return await import("../services/aiGateway.js");
  } finally {
    Object.assign(process.env, original);
  }
}

describe("aiGateway provider resolution (free tiers)", () => {
  it("resolves to 'none' when no key is present", async () => {
    const g = await loadGateway({ AI_PROVIDER: "gemini", AI_API_KEY: undefined });
    expect(g.aiProvider()).toBe("none");
    const info = g.aiConfigInfo();
    expect(info.requiredEnv).toContain("AI_API_KEY");
  });

  it("resolves to 'nim' and defaults to meta/muse-glimmer-30b once a key is set", async () => {
    const g = await loadGateway({ AI_PROVIDER: "nim", AI_API_KEY: "nvapi-test", AI_MODEL: undefined, AI_API_BASE: undefined });
    expect(g.aiProvider()).toBe("nim");
    expect(g.aiBaseUrl()).toBe("https://integrate.api.nvidia.com/v1");
    expect(g.aiModelName()).toBe("meta/muse-glimmer-30b");
  });

  it("resolves to 'gemini' and defaults to gemini-3.8-flash once a key is set", async () => {
    const g = await loadGateway({ AI_PROVIDER: "gemini", AI_API_KEY: "gkey", AI_MODEL: undefined, AI_API_BASE: undefined });
    expect(g.aiProvider()).toBe("gemini");
    expect(g.aiBaseUrl()).toContain("generativelanguage.googleapis.com");
    expect(g.aiModelName()).toBe("gemini-3.8-flash");
  });

  it("prefers an explicit model override", async () => {
    const g = await loadGateway({ AI_PROVIDER: "nim", AI_API_KEY: "k", AI_MODEL: "nvidia/nemotron-3.5-lightning-30b-a3b" });
    expect(g.aiModelName()).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
  });

  it("treats the provider as unconfigured (AI_NOT_CONFIGURED) without a key", async () => {
    const g = await loadGateway({ AI_PROVIDER: undefined, AI_API_KEY: undefined, AI_API_BASE: undefined });
    expect(g.aiProvider()).toBe("none");
  });
});