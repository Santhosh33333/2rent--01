import { Router } from "express";
import { authenticateToken } from "../middleware/auth";
import { sanitizeInput } from "../middleware/validation";
import * as musicRoomController from "../controllers/musicRoomController";

const router = Router();

// Any authenticated member may create or join a room. Per-room access inside
// each handler is membership-based: only members can read a room or its state,
// and only the host may add people, change the media or end it.
router.use(authenticateToken);

router.post("/", sanitizeInput, musicRoomController.createRoom);
router.get("/", musicRoomController.getRooms);

// Join by code. Declared before "/:id" so "join" is not read as a room id.
router.post("/join", sanitizeInput, musicRoomController.joinRoom);

router.get("/:id", musicRoomController.getRoom);
// Rename and/or change the media (host only). Playback control itself is over
// the socket, so a rapid play/pause/seek is not a REST round-trip.
router.patch("/:id", sanitizeInput, musicRoomController.setRoomMedia);
router.post("/:id/members", sanitizeInput, musicRoomController.addMembers);
router.post("/:id/leave", musicRoomController.leaveRoom);
router.post("/:id/end", musicRoomController.endRoom);

export default router;
