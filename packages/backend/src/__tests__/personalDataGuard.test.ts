import { describe, it, expect } from "vitest";
import { findPersonalData, containsPersonalData } from "../services/piiGuard";

/**
 * The personal-data guard is the only thing standing between a chat message and
 * a member being pushed onto an unmoderated channel. These pin both sides: it
 * must catch real contact details, and it must NOT swallow ordinary sentences,
 * because a false positive blocks a legitimate message.
 */
describe("piiGuard — catches contact details", () => {
  it("flags an email address", () => {
    expect(findPersonalData("mail me at jane.doe@example.com")?.category).toBe("EMAIL");
  });

  it("flags a full URL", () => {
    expect(findPersonalData("see https://example.com/jane")?.category).toBe("LINK");
  });

  it("flags a bare domain", () => {
    expect(findPersonalData("find me on instagram.com/jane")?.category).toBe("LINK");
  });

  it("flags a 10-digit phone number", () => {
    const found = findPersonalData("call me on 9876543210");
    expect(found?.category).toBe("PHONE");
  });

  it("flags a phone number written with separators", () => {
    expect(findPersonalData("+91 98765 43210")?.category).toBe("PHONE");
  });

  it("flags an @handle", () => {
    expect(findPersonalData("my handle is @jane_doe")?.category).toBe("HANDLE");
  });

  it("flags an explicit platform name", () => {
    expect(findPersonalData("message me on whatsapp")?.category).toBe("PLATFORM");
  });
});

describe("piiGuard — leaves ordinary chat alone", () => {
  it("allows a plain sentence", () => {
    expect(findPersonalData("Hey, how was your day?")).toBeNull();
  });

  it("does not treat a small number as a phone", () => {
    expect(findPersonalData("meet me at 5")).toBeNull();
    expect(findPersonalData("I have 12 rupees")).toBeNull();
  });

  it("does not flag a sentence ending in a normal word", () => {
    expect(findPersonalData("that went well.")).toBeNull();
  });

  it("does not flag the word signal or snap in normal use", () => {
    expect(findPersonalData("I gave a signal and took a snap")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(findPersonalData("")).toBeNull();
    expect(containsPersonalData("")).toBe(false);
  });
});
