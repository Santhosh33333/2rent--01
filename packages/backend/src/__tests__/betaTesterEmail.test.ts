/**
 * Beta invitation copy.
 *
 * The failure this guards against reached real testers: they tapped the email's
 * button, landed on "Become a tester" before joining the Google Group (or while
 * signed in to a different Google account), and Google Play answered "App not
 * available". The order of the three links and the explicit "use this exact
 * account" instruction are therefore load-bearing, not decoration.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../config/env", () => ({
  env: {
    BETA_TESTER_GROUP_EMAIL: "nabri-beta@googlegroups.com",
    SUPPORT_EMAIL: "nabri.support@gmail.com",
    EMAIL_FROM: "Nabri <noreply@yuvers.in>",
    EMAIL_PROVIDER: "none",
  },
}));
vi.mock("../config/database", () => ({ prisma: {} }));

import { betaTesterEmailContent } from "../services/emailService";

const GROUP_URL = "https://groups.google.com/g/nabri-beta";
const TESTING_URL = "https://play.google.com/apps/testing/app.rentbuddy.app";
const STORE_URL = "https://play.google.com/store/apps/details?id=app.rentbuddy.app";

describe("beta tester invitation", () => {
  const email = "tester@example.com";
  const { subject, html, text } = betaTesterEmailContent(email, "Test Tester");

  it("keeps a subject naming the beta list", () => {
    expect(subject).toContain("Nabri beta list");
  });

  it("sends the primary button to the Google Group, not the testing page", () => {
    // Google Play only grants access to the account that joined the group, so
    // the prominent action must be step 1. A CTA wired to the testing URL was
    // the original "App not available" bug.
    expect(html).toContain(`href="${GROUP_URL}" target="_blank"`);
    expect(html).toContain("Join the beta group");
    expect(html).not.toContain(`href="${TESTING_URL}" target="_blank"`);
  });

  it("still carries all three links, in order", () => {
    const groupAt = html.indexOf(GROUP_URL);
    const testingAt = html.indexOf(TESTING_URL);
    const storeAt = html.indexOf(STORE_URL);
    expect(groupAt).toBeGreaterThan(-1);
    expect(testingAt).toBeGreaterThan(groupAt);
    expect(storeAt).toBeGreaterThan(testingAt);
  });

  it("names the exact account and explains the mismatch", () => {
    expect(html).toContain(email);
    expect(html).toContain("App not available");
    expect(text).toContain(email);
    expect(text).toContain(GROUP_URL);
    expect(text).toContain(TESTING_URL);
    expect(text).toContain(STORE_URL);
  });

  it("renders no unresolved template placeholders", () => {
    expect(html).not.toMatch(/\$\{/);
    expect(text).not.toMatch(/\$\{/);
  });
});
