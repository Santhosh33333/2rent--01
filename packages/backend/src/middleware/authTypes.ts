import { Request } from "express";

export type UserRole =
  | "USER"
  | "PARTNER"
  | "MODERATOR"
  | "SUPPORT"
  | "FINANCE"
  | "SUPER_ADMIN"
  | "ADMIN";

export interface AuthenticatedUser {
  userId: string;
  email: string;
  role?: UserRole;
  activeRole?: UserRole;
}

export interface AuthedRequest extends Request {
  user?: AuthenticatedUser;
}
