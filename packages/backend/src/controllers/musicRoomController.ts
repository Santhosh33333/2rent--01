/**
 * Synchronized listening / watch-together rooms.
 *
 * A host creates a room, optionally loads a piece of media, and controls
 * playback; everyone who joins hears/sees the same thing in sync. The room state
 * (media + playhead + isPlaying) lives on the row, and playback *changes* are
 * pushed over the socket from services/socketService.ts. This file owns
 * membership and setup; the socket handlers own live control.
 *
 * Media is our own catalogue, a direct file the host supplies, or a single
 * YouTube video. See services/mediaUrl.ts for those rules — a YouTube *playlist*
 * is refused because it has no single position to synchronise.
 */
import { Response } from "express";
import path from "path";
import { AuthedRequest } from "../middleware/authTypes";
import { prisma } from "../config/database";
import { sendError, sendSuccess } from "../utils/response";
import { emitToMusicRoom } from "../services/socketService";
import { checkMediaUrl, describeMediaProblem } from "../services/mediaUrl";
import { removeBlob } from "../services/blobStorage";

const USER_SELECT = { id: true, fullName: true, avatarUrl: true } as const;
const MAX_NAME = 60;
const MAX_MEMBERS = 50;
/**
 * The creator decides how long an uploaded file lives. Bounded because the
 * value drives a stored date and a UI menu, not because anything breaks at 91.
 */
const MAX_RETENTION_DAYS = 90;
// Unambiguous alphabet: no O/0, I/1/L, so a spoken or hand-typed code is not a
// coin toss between two characters.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

type Membership = NonNullable<Awaited<ReturnType<typeof findMembership>>>;

function findMembership(roomId: string, userId: string) {
  return prisma.musicRoomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    include: {
      room: {
        select: {
          id: true,
          name: true,
          isActive: true,
          hostId: true,
          mediaUrl: true,
          mediaExpiresAt: true,
          retentionDays: true,
        },
      },
    },
  });
}

/**
 * The creator's chosen upload lifetime: whole days, 0 meaning "keep until the
 * room ends". Absent means 0. Returns null for anything else, so a bad value is
 * refused rather than silently coerced into a lifetime nobody asked for.
 */
function normaliseRetentionDays(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > MAX_RETENTION_DAYS) return null;
  return value;
}

/** When an upload taken now should be purged, or null to keep it. */
function expiryFor(retentionDays: number | undefined): Date | null {
  if (!retentionDays || retentionDays <= 0) return null;
  return new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);
}

/** True for a file this app stores, as opposed to a catalogue path or a link. */
function isUploadedMedia(url: string | null | undefined): url is string {
  return typeof url === "string" && url.startsWith("/uploads/");
}

/**
 * Delete a room's uploaded file, if it has one.
 *
 * The catalogue (/audio) is shared and owned by us — deleting it would break
 * every other room — and a link (https) is not ours to delete. Only a
 * `/uploads/...` blob belongs to this room.
 */
async function clearUploadedMedia(mediaUrl: string | null | undefined): Promise<void> {
  if (isUploadedMedia(mediaUrl)) await removeBlob(mediaUrl);
}

/**
 * Drop an upload whose retention window has passed.
 *
 * Lazy rather than scheduled: a cron would need its own deploy target and would
 * still race the read that follows it, and a room nobody opens has no one to
 * surprise. The purge runs on the read paths, so the first person to look at an
 * expired room sees it already cleared. Returns true when something was dropped.
 */
async function purgeExpiredMedia(room: {
  id: string;
  mediaUrl: string | null;
  mediaExpiresAt: Date | null;
}): Promise<boolean> {
  if (!room.mediaExpiresAt || room.mediaExpiresAt.getTime() > Date.now()) return false;

  await clearUploadedMedia(room.mediaUrl);

  const updated = await prisma.musicRoom
    .update({
      where: { id: room.id },
      data: {
        mediaUrl: null,
        mediaTitle: null,
        mediaKind: "AUDIO",
        mediaExpiresAt: null,
        isPlaying: false,
        positionSec: 0,
        version: { increment: 1 },
      },
    })
    .catch(() => null);
  if (updated) emitRoomSync(updated);
  return true;
}

function makeCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/** A code nobody else holds. Retries a handful of times before giving up. */
async function uniqueCode(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = makeCode();
    const clash = await prisma.musicRoom.findUnique({ where: { code }, select: { id: true } });
    if (!clash) return code;
  }
  throw new Error("could not allocate a room code");
}

/**
 * Push the room's current media + playhead to everyone in it.
 *
 * Shared by every path that changes what is playing (REST set-media, upload),
 * so the payload a guest receives is identical no matter which door the host
 * came through — the drift this feature can least afford is between its own
 * two writers.
 */
function emitRoomSync(room: {
  id: string;
  version: number;
  mediaKind: string;
  mediaUrl: string | null;
  mediaTitle: string | null;
  isPlaying: boolean;
  positionSec: number;
  updatedAt: Date;
}): void {
  emitToMusicRoom(room.id, "music_room_sync", {
    roomId: room.id,
    version: room.version,
    mediaKind: room.mediaKind,
    mediaUrl: room.mediaUrl,
    mediaTitle: room.mediaTitle,
    isPlaying: room.isPlaying,
    positionSec: room.positionSec,
    updatedAt: room.updatedAt,
  });
}

function memberSummary(room: {
  id: string;
  code: string;
  name: string;
  hostId: string;
  isActive: boolean;
  mediaKind: string;
  mediaUrl: string | null;
  mediaTitle: string | null;
  retentionDays: number;
  mediaExpiresAt: Date | null;
  isPlaying: boolean;
  positionSec: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}, memberCount: number, myRole: string) {
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    hostId: room.hostId,
    isActive: room.isActive,
    mediaKind: room.mediaKind,
    mediaUrl: room.mediaUrl,
    mediaTitle: room.mediaTitle,
    retentionDays: room.retentionDays,
    mediaExpiresAt: room.mediaExpiresAt,
    isPlaying: room.isPlaying,
    positionSec: room.positionSec,
    version: room.version,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    memberCount,
    myRole,
  };
}

// ============================================================================
// ROOMS
// ============================================================================

export async function createRoom(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) {
      sendError(res, "Give the room a name.", 400, "VALIDATION_ERROR");
      return;
    }
    if (name.length > MAX_NAME) {
      sendError(res, `Room name cannot be longer than ${MAX_NAME} characters.`, 400, "VALIDATION_ERROR");
      return;
    }

    let mediaKind = "AUDIO";
    let mediaUrl: string | null = null;
    const mediaTitle =
      typeof req.body?.mediaTitle === "string" ? req.body.mediaTitle.trim().slice(0, 200) : null;

    if (typeof req.body?.mediaUrl === "string" && req.body.mediaUrl.trim()) {
      const check = checkMediaUrl(req.body.mediaUrl);
      if (!check.ok) {
        sendError(res, describeMediaProblem(check.problem), 400, "INVALID_MEDIA");
        return;
      }
      mediaKind = check.kind;
      mediaUrl = check.url;
    }

    const code = await uniqueCode();
    const retentionDays = normaliseRetentionDays(req.body?.retentionDays);
    if (retentionDays === null) {
      sendError(
        res,
        `Choose how long uploads last, between 0 and ${MAX_RETENTION_DAYS} days (0 keeps them until the room ends).`,
        400,
        "VALIDATION_ERROR"
      );
      return;
    }

    const room = await prisma.musicRoom.create({
      data: {
        code,
        name,
        hostId: userId,
        mediaKind,
        mediaUrl,
        mediaTitle,
        retentionDays,
        mediaExpiresAt: isUploadedMedia(mediaUrl) ? expiryFor(retentionDays) : null,
        members: { create: [{ userId, role: "HOST" }] },
      },
    });

    sendSuccess(res, memberSummary(room, 1, "HOST"), "Room created.", 201);
  } catch (err: any) {
    console.error("[createMusicRoom]", err?.message);
    sendError(res, "Failed to create the room.", 500, "INTERNAL_ERROR");
  }
}

export async function getRooms(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const memberships = await prisma.musicRoomMember.findMany({
      where: { userId, room: { isActive: true } },
      include: {
        room: {
          include: {
            _count: { select: { members: true } },
            host: { select: USER_SELECT },
          },
        },
      },
    });

    // Uploads past their retention window are dropped as the list is read, so
    // an expiry needs no scheduler and the owner never sees a stale track.
    for (const m of memberships) {
      if (await purgeExpiredMedia(m.room)) {
        m.room.mediaUrl = null;
        m.room.mediaTitle = null;
        m.room.mediaKind = "AUDIO";
        m.room.mediaExpiresAt = null;
        m.room.isPlaying = false;
      }
    }

    const items = memberships
      .map((m) => ({
        ...memberSummary(m.room, m.room._count.members, m.role),
        host: m.room.host,
      }))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    sendSuccess(res, { items, total: items.length });
  } catch (err: any) {
    console.error("[getMusicRooms]", err?.message);
    sendError(res, "Failed to load rooms.", 500, "INTERNAL_ERROR");
  }
}

export async function getRoom(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const membership = await findMembership(req.params.id, userId);
    if (!membership || !membership.room.isActive) {
      sendError(res, "Room not found.", 404, "ROOM_NOT_FOUND");
      return;
    }

    // Drop an expired upload before reading the room, so nobody is handed a
    // media URL that is about to disappear.
    await purgeExpiredMedia(membership.room);

    const room = await prisma.musicRoom.findUnique({
      where: { id: req.params.id },
      include: {
        host: { select: USER_SELECT },
        members: {
          orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
          include: { user: { select: USER_SELECT } },
        },
        _count: { select: { members: true } },
      },
    });
    if (!room) {
      sendError(res, "Room not found.", 404, "ROOM_NOT_FOUND");
      return;
    }

    // Raw playhead, deliberately *not* pre-advanced by elapsed time. The client
    // applies one rule to this and to a live socket sync — position + elapsed
    // since `updatedAt` — so adding elapsed here too would double-count and drop
    // a joining guest past the host.
    sendSuccess(res, {
      ...memberSummary(room, room._count.members, membership.role),
      host: room.host,
      members: room.members.map((mem) => ({
        userId: mem.userId,
        role: mem.role,
        joinedAt: mem.joinedAt,
        user: mem.user,
      })),
    });
  } catch (err: any) {
    console.error("[getMusicRoom]", err?.message);
    sendError(res, "Failed to load the room.", 500, "INTERNAL_ERROR");
  }
}

export async function joinRoom(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const code = typeof req.body?.code === "string" ? req.body.code.trim().toUpperCase() : "";
    if (!code) {
      sendError(res, "Enter the room code.", 400, "VALIDATION_ERROR");
      return;
    }

    const room = await prisma.musicRoom.findUnique({
      where: { code },
      include: { _count: { select: { members: true } } },
    });
    if (!room || !room.isActive) {
      sendError(res, "No open room with that code.", 404, "ROOM_NOT_FOUND");
      return;
    }

    const existing = await findMembership(room.id, userId);
    if (!existing && room._count.members >= MAX_MEMBERS) {
      sendError(res, "This room is full.", 409, "ROOM_FULL");
      return;
    }

    await prisma.musicRoomMember.upsert({
      where: { roomId_userId: { roomId: room.id, userId } },
      create: { roomId: room.id, userId, role: "GUEST" },
      update: {},
    });

    emitToMusicRoom(room.id, "music_room_presence", { roomId: room.id, memberCount: room._count.members + (existing ? 0 : 1) });

    sendSuccess(res, { roomId: room.id, name: room.name }, "Joined the room.");
  } catch (err: any) {
    console.error("[joinMusicRoom]", err?.message);
    sendError(res, "Failed to join the room.", 500, "INTERNAL_ERROR");
  }
}

export async function addMembers(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const membership = await findMembership(req.params.id, userId);
    if (!membership || !membership.room.isActive) {
      sendError(res, "Room not found.", 404, "ROOM_NOT_FOUND");
      return;
    }
    if (membership.role !== "HOST") {
      sendError(res, "Only the host can add people.", 403, "FORBIDDEN");
      return;
    }

    const raw: unknown = req.body?.userIds;
    const ids = Array.isArray(raw)
      ? [...new Set(raw.filter((v): v is string => typeof v === "string" && v.length > 0 && v !== userId))]
      : [];
    if (ids.length === 0) {
      sendError(res, "Select at least one person.", 400, "VALIDATION_ERROR");
      return;
    }
    if (ids.length > MAX_MEMBERS) {
      sendError(res, `You can add at most ${MAX_MEMBERS} people at once.`, 400, "VALIDATION_ERROR");
      return;
    }

    const found = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (found.length !== ids.length) {
      sendError(res, "One or more selected users do not exist.", 400, "INVALID_MEMBER");
      return;
    }

    await prisma.$transaction(
      ids.map((id) =>
        prisma.musicRoomMember.upsert({
          where: { roomId_userId: { roomId: req.params.id, userId: id } },
          create: { roomId: req.params.id, userId: id, role: "GUEST" },
          update: {},
        })
      )
    );

    const count = await prisma.musicRoomMember.count({ where: { roomId: req.params.id } });
    emitToMusicRoom(req.params.id, "music_room_presence", { roomId: req.params.id, memberCount: count });

    sendSuccess(res, { added: ids.length, memberCount: count }, "Members added.");
  } catch (err: any) {
    console.error("[addMusicRoomMembers]", err?.message);
    sendError(res, "Failed to add members.", 500, "INTERNAL_ERROR");
  }
}

export async function leaveRoom(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const membership = await findMembership(req.params.id, userId);
    if (!membership) {
      sendError(res, "Room not found.", 404, "ROOM_NOT_FOUND");
      return;
    }

    const remaining = await prisma.musicRoomMember.findMany({
      where: { roomId: req.params.id, userId: { not: userId } },
      orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
      select: { userId: true },
    });

    if (remaining.length === 0) {
      // Last person out ends the room rather than leaving an empty shell that
      // still holds a code nobody is listening on.
      await clearUploadedMedia(membership.room.mediaUrl);
      await prisma.musicRoom.update({ where: { id: req.params.id }, data: { isActive: false, isPlaying: false } });
      emitToMusicRoom(req.params.id, "music_room_ended", { roomId: req.params.id });
      sendSuccess(res, { roomId: req.params.id, left: true, ended: true }, "You left the room.");
      return;
    }

    await prisma.musicRoomMember.delete({ where: { roomId_userId: { roomId: req.params.id, userId } } });

    // The host leaving hands the controls to the longest-standing guest, so the
    // room is never left without someone who can play the next track.
    if (membership.role === "HOST") {
      const successor = remaining[0].userId;
      await prisma.musicRoomMember.update({
        where: { roomId_userId: { roomId: req.params.id, userId: successor } },
        data: { role: "HOST" },
      });
      await prisma.musicRoom.update({ where: { id: req.params.id }, data: { hostId: successor } });
      emitToMusicRoom(req.params.id, "music_room_host_changed", { roomId: req.params.id, hostId: successor });
    }

    emitToMusicRoom(req.params.id, "music_room_presence", { roomId: req.params.id, memberCount: remaining.length });
    sendSuccess(res, { roomId: req.params.id, left: true }, "You left the room.");
  } catch (err: any) {
    console.error("[leaveMusicRoom]", err?.message);
    sendError(res, "Failed to leave the room.", 500, "INTERNAL_ERROR");
  }
}

export async function endRoom(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const membership = await findMembership(req.params.id, userId);
    if (!membership) {
      sendError(res, "Room not found.", 404, "ROOM_NOT_FOUND");
      return;
    }
    if (membership.role !== "HOST") {
      sendError(res, "Only the host can end the room.", 403, "FORBIDDEN");
      return;
    }

    // The room is over, so its uploaded file has no reason to remain.
    await clearUploadedMedia(membership.room.mediaUrl);

    await prisma.musicRoom.update({ where: { id: req.params.id }, data: { isActive: false, isPlaying: false } });
    emitToMusicRoom(req.params.id, "music_room_ended", { roomId: req.params.id });
    sendSuccess(res, { roomId: req.params.id, ended: true }, "Room ended.");
  } catch (err: any) {
    console.error("[endMusicRoom]", err?.message);
    sendError(res, "Failed to end the room.", 500, "INTERNAL_ERROR");
  }
}

/**
 * Remove a room for good (host only).
 *
 * `endRoom` closes a room but keeps the row, so its code cannot be reused and
 * its history survives; this is the creator deciding the room should not exist
 * at all. Memberships cascade with it, and its uploaded file is deleted.
 */
export async function deleteRoom(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const membership = await findMembership(req.params.id, req.user!.userId);
    if (!membership) {
      sendError(res, "Room not found.", 404, "ROOM_NOT_FOUND");
      return;
    }
    if (membership.role !== "HOST") {
      sendError(res, "Only the host can remove the room.", 403, "FORBIDDEN");
      return;
    }

    await clearUploadedMedia(membership.room.mediaUrl);

    await prisma.$transaction([
      prisma.musicRoomMember.deleteMany({ where: { roomId: req.params.id } }),
      prisma.musicRoom.delete({ where: { id: req.params.id } }),
    ]);

    emitToMusicRoom(req.params.id, "music_room_ended", { roomId: req.params.id });
    sendSuccess(res, { roomId: req.params.id, deleted: true }, "Room removed.");
  } catch (err: any) {
    console.error("[deleteMusicRoom]", err?.message);
    sendError(res, "Failed to remove the room.", 500, "INTERNAL_ERROR");
  }
}

/**
 * Change the room's media (host only), from the picker or the rename dialog.
 * Playback is reset to the start and broadcast, so everyone loads the new track
 * together instead of drifting to whatever each client last had.
 */
export async function setRoomMedia(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const membership = await findMembership(req.params.id, userId);
    if (!membership || !membership.room.isActive) {
      sendError(res, "Room not found.", 404, "ROOM_NOT_FOUND");
      return;
    }
    if (membership.role !== "HOST") {
      sendError(res, "Only the host can change what is playing.", 403, "FORBIDDEN");
      return;
    }

    const data: {
      name?: string;
      mediaKind?: string;
      mediaUrl?: string | null;
      mediaTitle?: string | null;
      mediaExpiresAt?: Date | null;
      retentionDays?: number;
    } = {};
    if (typeof req.body?.name === "string") {
      const name = req.body.name.trim();
      if (!name || name.length > MAX_NAME) {
        sendError(res, `Room name must be 1-${MAX_NAME} characters.`, 400, "VALIDATION_ERROR");
        return;
      }
      data.name = name;
    }

    // The creator can shorten or extend how long the upload lasts without
    // touching what is playing.
    let retentionDays = membership.room.retentionDays;
    if (req.body?.retentionDays !== undefined) {
      const parsed = normaliseRetentionDays(req.body.retentionDays);
      if (parsed === null) {
        sendError(res, `Uploads can last between 0 and ${MAX_RETENTION_DAYS} days.`, 400, "VALIDATION_ERROR");
        return;
      }
      retentionDays = parsed;
      data.retentionDays = parsed;
    }

    const clearing = req.body?.mediaUrl === null || req.body?.mediaUrl === "";
    if (clearing) {
      data.mediaUrl = null;
      data.mediaTitle = null;
      data.mediaKind = "AUDIO";
      data.mediaExpiresAt = null;
    } else if (typeof req.body?.mediaUrl === "string") {
      const check = checkMediaUrl(req.body.mediaUrl);
      if (!check.ok) {
        sendError(res, describeMediaProblem(check.problem), 400, "INVALID_MEDIA");
        return;
      }
      data.mediaUrl = check.url;
      data.mediaKind = check.kind;
      data.mediaTitle =
        typeof req.body?.mediaTitle === "string" ? req.body.mediaTitle.trim().slice(0, 200) : null;
      // Only an uploaded file ages out; a catalogue path and a link do not.
      data.mediaExpiresAt = isUploadedMedia(check.url) ? expiryFor(retentionDays) : null;
    } else if (data.retentionDays !== undefined && isUploadedMedia(membership.room.mediaUrl)) {
      // Retention changed on its own — re-base the existing upload's clock.
      data.mediaExpiresAt = expiryFor(retentionDays);
    }

    // A replaced (or cleared) upload's blob is removed rather than orphaned.
    const previous = membership.room.mediaUrl;
    if (data.mediaUrl !== undefined && isUploadedMedia(previous) && previous !== data.mediaUrl) {
      await removeBlob(previous);
    }

    const updated = await prisma.musicRoom.update({
      where: { id: req.params.id },
      data: { ...data, positionSec: 0, isPlaying: false, version: { increment: 1 } },
    });

    emitRoomSync(updated);

    sendSuccess(res, memberSummary(updated, 0, membership.role), "Room updated.");
  } catch (err: any) {
    console.error("[setMusicRoomMedia]", err?.message);
    sendError(res, "Failed to update the room.", 500, "INTERNAL_ERROR");
  }
}

/**
 * Upload a file from the host's device and make it the room's media (host only).
 *
 * Exists so a room can be started without the host first finding somewhere to
 * host a file: the catalogue is licensed content the app does not own, so the
 * practical way to get real music into a room is the host's own file. The format
 * is validated against the same rules as a pasted link (`checkMediaUrl`), which
 * is why an audio upload cannot sneak in a type the player would then refuse.
 */
export async function uploadRoomMedia(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const membership = await findMembership(req.params.id, userId);
    if (!membership || !membership.room.isActive) {
      sendError(res, "Room not found.", 404, "ROOM_NOT_FOUND");
      return;
    }
    if (membership.role !== "HOST") {
      sendError(res, "Only the host can change what is playing.", 403, "FORBIDDEN");
      return;
    }

    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      sendError(res, "Choose a file to upload.", 400, "VALIDATION_ERROR");
      return;
    }

    const mediaUrl = `/uploads/${file.filename}`;
    const check = checkMediaUrl(mediaUrl);
    if (!check.ok) {
      // The multer filter already restricts this, but re-check so a stored blob
      // can never become room state the player then fails on.
      sendError(res, describeMediaProblem(check.problem), 400, "INVALID_MEDIA");
      return;
    }

    const titleInput = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const fallback = file.originalname ? path.parse(file.originalname).name : check.kind === "VIDEO" ? "Video" : "Song";
    const mediaTitle = (titleInput || fallback).slice(0, 200);

    // Replace the previous upload instead of orphaning its blob. Only an
    // upload is deleted — a catalogue path is shared and a link is not ours.
    const previous = membership.room.mediaUrl;
    if (isUploadedMedia(previous) && previous !== mediaUrl) await removeBlob(previous);

    const updated = await prisma.musicRoom.update({
      where: { id: req.params.id },
      data: {
        mediaUrl,
        mediaKind: check.kind,
        mediaTitle,
        mediaExpiresAt: expiryFor(membership.room.retentionDays),
        positionSec: 0,
        isPlaying: false,
        version: { increment: 1 },
      },
    });

    emitRoomSync(updated);

    sendSuccess(res, memberSummary(updated, 0, membership.role), "Media added to the room.");
  } catch (err: any) {
    console.error("[uploadMusicRoomMedia]", err?.message);
    sendError(res, "Failed to upload the media.", 500, "INTERNAL_ERROR");
  }
}

export type { Membership };
