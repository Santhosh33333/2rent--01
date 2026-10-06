import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Who gets told about an SOS, and through what.
 *
 * Two things here are worth pinning. First, rows are written with individual
 * `create` calls, because `createMany` is a different Prisma action that never
 * reaches the `$use` middleware on Notification.create - the middleware that
 * fans a row out to the realtime event and to FCM push. A bulk write would
 * look correct, land in the notification list, and reach nobody's phone.
 *
 * Second, the sender is excluded: the button they pressed already confirmed
 * the alert, and a blocking dialog about their own emergency pulls attention
 * off whoever has to respond to it.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findMany: vi.fn() },
    notification: { create: vi.fn(), createMany: vi.fn() },
  },
}));

vi.mock("../config/database", () => ({ prisma: prismaMock }));

import { notifySosRecipients, SOS_ADMIN_ROLES } from "../services/sosNotifications";

const BOOKING = "bkg_1";
const PARTNER = "usr_partner";
const CIVILIAN = "usr_civilian";

function base(over: Record<string, unknown> = {}) {
  return {
    bookingId: BOOKING,
    triggeredBy: CIVILIAN,
    partyUserIds: [CIVILIAN, PARTNER],
    message: "Emergency SOS",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks only empties the call history: queued `*Once` values and
  // implementations survive it, so a leftover mockResolvedValueOnce from an
  // earlier test would silently beat a mockRejectedValue set below. Reset
  // first, then install the defaults every test starts from.
  prismaMock.user.findMany.mockReset();
  prismaMock.notification.create.mockReset();
  prismaMock.notification.createMany.mockReset();
  prismaMock.user.findMany.mockResolvedValue([]);
  prismaMock.notification.create.mockResolvedValue({ id: "not_1" });
  prismaMock.notification.createMany.mockResolvedValue({ count: 0 });
});

describe("notifySosRecipients - who is told", () => {
  it("tells the other party on the booking", async () => {
    const notified = await notifySosRecipients(base());
    expect(notified).toEqual([PARTNER]);
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: PARTNER }) }),
    );
  });

  it("never tells the person who pressed the button", async () => {
    const notified = await notifySosRecipients(base({ triggeredBy: PARTNER }));
    expect(notified).toEqual([CIVILIAN]);
    expect(notified).not.toContain(PARTNER);
  });

  it("drops the sender even when they are also an admin", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: CIVILIAN }, { id: "usr_admin" }]);
    const notified = await notifySosRecipients(base());
    expect(notified.sort()).toEqual(["usr_admin", PARTNER]);
  });

  it("adds every active admin", async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: "usr_admin" },
      { id: "usr_support" },
    ]);
    const notified = await notifySosRecipients(base());
    expect(notified.sort()).toEqual(["usr_admin", "usr_partner", "usr_support"]);
  });

  it("asks for exactly the roles that join the admins socket room", async () => {
    // Push and realtime have to agree on who is watching, or an admin gets the
    // tray notification without the live alert and vice versa.
    await notifySosRecipients(base());
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: { in: [...SOS_ADMIN_ROLES] }, status: "ACTIVE" },
      }),
    );
  });

  it("still alerts the booking parties when the admin lookup fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    prismaMock.user.findMany.mockRejectedValue(new Error("db down"));

    const notified = await notifySosRecipients(base());

    expect(notified).toEqual([PARTNER]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("covers a booking with no assigned partner", async () => {
    const notified = await notifySosRecipients(base({ partyUserIds: [CIVILIAN, null] }));
    expect(notified).toEqual([]);
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });
});

describe("notifySosRecipients - how it is written", () => {
  it("writes one row per recipient rather than through createMany", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: "usr_admin" }]);
    await notifySosRecipients(base());
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
  });

  it("files an unread row carrying the SOS type", async () => {
    await notifySosRecipients(base());
    const data = prismaMock.notification.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ title: "Emergency SOS", isRead: false });
    expect(JSON.parse(data.data)).toMatchObject({
      type: "SOS",
      bookingId: BOOKING,
      triggeredBy: CIVILIAN,
    });
  });

  it("puts coordinates in the body, where a responder actually reads them", async () => {
    await notifySosRecipients(base({ latitude: 13.0827, longitude: 80.2707 }));
    const body = prismaMock.notification.create.mock.calls[0][0].data.body;
    expect(body).toContain("13.0827, 80.2707");
    expect(body).toContain(BOOKING);
  });

  it("omits the location line when there are no coordinates", async () => {
    await notifySosRecipients(base({ latitude: null, longitude: null }));
    const body = prismaMock.notification.create.mock.calls[0][0].data.body;
    expect(body).not.toContain("Location:");
    expect(body).toContain(BOOKING);
  });

  it("omits the location line when only one coordinate is known", async () => {
    // A half coordinate pair reads as a real place somewhere it is not.
    await notifySosRecipients(base({ latitude: 13.0827, longitude: null }));
    const body = prismaMock.notification.create.mock.calls[0][0].data.body;
    expect(body).not.toContain("Location:");
  });
});

describe("notifySosRecipients - failure never costs the alert", () => {
  it("reports only the recipients whose row actually landed", async () => {
    // Two recipients, one write each: the failure has to stay local to the
    // row it happened on rather than costing the other person their alert.
    prismaMock.user.findMany.mockResolvedValue([{ id: "usr_admin" }]);
    prismaMock.notification.create
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce({ id: "not_2" });

    const notified = await notifySosRecipients(base());

    expect(notified).toEqual(["usr_admin"]);
  });

  it("returns an empty list instead of throwing when every write fails", async () => {
    prismaMock.notification.create.mockRejectedValue(new Error("db down"));
    await expect(notifySosRecipients(base())).resolves.toEqual([]);
  });

  it("returns an empty list rather than failing the SOS that called it", async () => {
    prismaMock.user.findMany.mockRejectedValue(new Error("db down"));
    prismaMock.notification.create.mockRejectedValue(new Error("db down"));
    await expect(
      notifySosRecipients(base({ partyUserIds: [CIVILIAN, PARTNER] })),
    ).resolves.toEqual([]);
  });
});
