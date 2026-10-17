import { describe, it, expect } from "vitest";
import {
  capabilityFilter,
  connectModeForBooking,
  connectModeFromNotes,
  partnerServes,
  withConnectMode,
} from "../services/connectMode";

describe("connectMode", () => {
  it("reads the channel the booking page records", () => {
    expect(connectModeFromNotes("Connect by call")).toBe("CALL");
    expect(connectModeFromNotes("Connect by chat")).toBe("CHAT");
  });

  it("reads the channel out of the JSON notes shape", () => {
    expect(connectModeFromNotes(JSON.stringify({ text: "Connect by call", sameGenderOnly: true }))).toBe("CALL");
    expect(connectModeFromNotes(JSON.stringify({ reminderSentAt: "2026-10-17T00:00:00.000Z" }))).toBeNull();
  });

  it("treats a booking with no channel as matching everyone", () => {
    expect(connectModeFromNotes(null)).toBeNull();
    expect(connectModeFromNotes("Please be on time")).toBeNull();
    expect(capabilityFilter(null)).toEqual({});
    expect(partnerServes({ providesWalking: true, providesCarry: false }, null)).toBe(true);
  });

  it("records the marker once and keeps the note text", () => {
    expect(withConnectMode(undefined, "CALL")).toBe("Connect by call");
    expect(withConnectMode("Connect by call", "CALL")).toBe("Connect by call");
    expect(withConnectMode("Be on time", "CHAT")).toBe("Connect by chat — Be on time");
    expect(withConnectMode("Be on time", undefined)).toBe("Be on time");
    expect(connectModeFromNotes(withConnectMode("Be on time", "CHAT"))).toBe("CHAT");
  });

  it("keeps the retired walking/carry mapping for historic bookings", () => {
    expect(connectModeForBooking({ serviceType: "WALKING", notes: null })).toBe("CALL");
    expect(connectModeForBooking({ serviceType: "CARRY_BUDDY", notes: null })).toBe("CHAT");
    expect(connectModeForBooking({ serviceType: "TALK", notes: "Connect by chat" })).toBe("CHAT");
  });

  it("only offers the jobs the partner said they take", () => {
    const callOnly = { providesWalking: true, providesCarry: false };
    const chatOnly = { providesWalking: false, providesCarry: true };

    expect(partnerServes(callOnly, "CALL")).toBe(true);
    expect(partnerServes(callOnly, "CHAT")).toBe(false);
    expect(partnerServes(chatOnly, "CHAT")).toBe(true);
    expect(partnerServes(chatOnly, "CALL")).toBe(false);

    // A partner who recorded no preference must not be locked out of work.
    expect(partnerServes({ providesWalking: false, providesCarry: false }, "CALL")).toBe(true);

    expect(capabilityFilter("CALL")).toEqual({ providesWalking: true });
    expect(capabilityFilter("CHAT")).toEqual({ providesCarry: true });
  });
});
