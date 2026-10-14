/**
 * Synchronized listening / watch-together rooms.
 *
 * A host creates a room, optionally loads a piece of media, and controls
 * playback; everyone who joins hears/sees the same thing in sync. The room state
 * (media + playhead + isPlaying) lives on the row, and playback *changes* are
 * pushed over the socket from services/socketService.ts. This file owns
 * membership and setup; the socket handlers own live control.
 *
 * Media is always our own or a direct file the host supplies — never YouTube.
 * See services/mediaUrl.ts for that rule and the reason behind it.
 */
import { Response } from "express";
import path from "path";
import { AuthedRequest } from "../middleware/authTypes";
import { prisma } from "../config/database";
import { sendError, sendSuccess } from "../utils/response";
import { emitToMusicRoom } from "../services/socketService";
import { checkMediaUrl, describeMediaProblem } from "../services/mediaUrl";

const USER_SELECT = { id: true, fullName: true, avatarUrl: true } as const;
const MAX_NAME = 60;
const MAX_MEMBERS = 50;
// Unambiguous alphabet: no O/0, I/1/L, so a spoken or hand-typed code is not a
// coin toss between two characters.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

type Membership = NonNullable<Awaited<ReturnType<typeof findMembership>>>;

function findMembership(roomId: string, userId: string) {
  return prisma.musicRoomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    include: { room: { select: { id: true, name: true, isActive: true, hostId: true } } },
  });
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
    const room = await prisma.musicRoom.create({
      data: {
        code,
        name,
        hostId: userId,
        mediaKind,
        mediaUrl,
        mediaTitle,
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

    await prisma.musicRoom.update({ where: { id: req.params.id }, data: { isActive: false, isPlaying: false } });
    emitToMusicRoom(req.params.id, "music_room_ended", { roomId: req.params.id });
    sendSuccess(res, { roomId: req.params.id, ended: true }, "Room ended.");
  } catch (err: any) {
    console.error("[endMusicRoom]", err?.message);
    sendError(res, "Failed to end the room.", 500, "INTERNAL_ERROR");
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

    const data: { name?: string; mediaKind?: string; mediaUrl?: string | null; mediaTitle?: string | null } = {};
    if (typeof req.body?.name === "string") {
      const name = req.body.name.trim();
      if (!name || name.length > MAX_NAME) {
        sendError(res, `Room name must be 1-${MAX_NAME} characters.`, 400, "VALIDATION_ERROR");
        return;
      }
      data.name = name;
    }

    const clearing = req.body?.mediaUrl === null || req.body?.mediaUrl === "";
    if (clearing) {
      data.mediaUrl = null;
      data.mediaTitle = null;
      data.mediaKind = "AUDIO";
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

    const updated = await prisma.musicRoom.update({
      where: { id: req.params.id },
      data: {
        mediaUrl,
        mediaKind: check.kind,
        mediaTitle,
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
