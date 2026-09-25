import React, { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState } from "react";
import { App } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { useAuth } from "./auth";

const SETTINGS_KEY = "applock_settings";
export const LOCKOUT_AFTER_ATTEMPTS = 5;
export const LOCKOUT_SECONDS = 30;

interface AppLockSettings {
  enabled: boolean;
  salt?: string;
  pinHash?: string;
  autoLockSec: number;
  wrongAttempts: number;
  lastWrongAt?: number;
}

interface AppLockContextValue {
  enabled: boolean;
  autoLockSec: number;
  locked: boolean;
  lockoutSecondsLeft: number;
  verify: (pin: string) => Promise<boolean>;
  enable: (pin: string, autoLockSec?: number) => Promise<void>;
  disable: (pin: string) => Promise<boolean>;
  changePin: (oldPin: string, newPin: string) => Promise<"ok" | "wrong">;
  lockNow: () => void;
  setAutoLockSec: (sec: number) => void;
  signOut: () => void;
}

function readSettings(): AppLockSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { enabled: false, autoLockSec: 0, wrongAttempts: 0 };
    const p = JSON.parse(raw) as Partial<AppLockSettings>;
    return {
      enabled: Boolean(p.enabled),
      salt: typeof p.salt === "string" ? p.salt : undefined,
      pinHash: typeof p.pinHash === "string" ? p.pinHash : undefined,
      autoLockSec: Number.isFinite(Number(p.autoLockSec)) ? Number(p.autoLockSec) : 0,
      wrongAttempts: Number.isFinite(Number(p.wrongAttempts)) ? Number(p.wrongAttempts) : 0,
      lastWrongAt: typeof p.lastWrongAt === "number" ? p.lastWrongAt : undefined,
    };
  } catch {
    return { enabled: false, autoLockSec: 0, wrongAttempts: 0 };
  }
}

function writeSettings(s: AppLockSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Degraded fallback on non-secure contexts (the APK is always https).
  let h = 5381;
  for (const b of data) h = ((h << 5) + h + b) >>> 0;
  return `fb-${h.toString(16)}`;
}

const AppLockContext = createContext<AppLockContextValue | null>(null);

export function AppLockProvider({ children }: { children: React.ReactNode }) {
  const { logout } = useAuth();
  const [settings, setSettings] = useState<AppLockSettings>(() => readSettings());
  const [locked, setLocked] = useState(false);
  const [, pingTicker] = useReducer((c: number) => c + 1, 0);
  const bgAtRef = useRef<number | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const ping = useCallback(() => pingTicker(), []);
  const lockNow = useCallback(() => {
    if (settingsRef.current.enabled) setLocked(true);
  }, []);
  const enable = useCallback(async (pin: string, autoLockSec = 0) => {
    const next: AppLockSettings = { enabled: true, salt: newId(), pinHash: "", autoLockSec, wrongAttempts: 0, lastWrongAt: undefined };
    next.pinHash = await hashPin(pin, next.salt!);
    writeSettings(next);
    setSettings(next);
  }, []);
  const verify = useCallback(
    async (pin: string): Promise<boolean> => {
      const s = readSettings();
      const now = Date.now();
      if (s.wrongAttempts >= LOCKOUT_AFTER_ATTEMPTS && s.lastWrongAt && now - s.lastWrongAt < LOCKOUT_SECONDS * 1000) {
        ping();
        return false;
      }
      if (!s.pinHash || !s.salt) return false;
      const h = await hashPin(pin, s.salt);
      if (h === s.pinHash) {
        writeSettings({ ...s, wrongAttempts: 0, lastWrongAt: undefined });
        setSettings({ ...s, wrongAttempts: 0, lastWrongAt: undefined });
        setLocked(false);
        return true;
      }
      const resetWindow = s.lastWrongAt && now - s.lastWrongAt > 15 * 60 * 1000;
      const next: AppLockSettings = { ...s, wrongAttempts: resetWindow ? 1 : s.wrongAttempts + 1, lastWrongAt: now };
      writeSettings(next);
      setSettings(next);
      ping();
      return false;
    },
    [ping]
  );
  const disable = useCallback(
    async (pin: string): Promise<boolean> => {
      const s = readSettings();
      if (!s.pinHash || !s.salt) return false;
      if ((await hashPin(pin, s.salt)) !== s.pinHash) return false;
      const next: AppLockSettings = { enabled: false, autoLockSec: 0, wrongAttempts: 0, lastWrongAt: undefined, salt: undefined, pinHash: undefined };
      writeSettings(next);
      setSettings(next);
      setLocked(false);
      return true;
    },
    []
  );
  const changePin = useCallback(
    async (oldPin: string, newPin: string): Promise<"ok" | "wrong"> => {
      const s = readSettings();
      if (!s.pinHash || !s.salt) return "wrong";
      if ((await hashPin(oldPin, s.salt)) !== s.pinHash) return "wrong";
      const salt = newId();
      const pinHash = await hashPin(newPin, salt);
      const next: AppLockSettings = { ...s, salt, pinHash, wrongAttempts: 0, lastWrongAt: undefined };
      writeSettings(next);
      setSettings(next);
      return "ok";
    },
    []
  );
  const setAutoLockSec = useCallback((sec: number) => {
    const next: AppLockSettings = { ...readSettings(), autoLockSec: sec, wrongAttempts: 0, lastWrongAt: undefined };
    writeSettings(next);
    setSettings(next);
  }, []);
  const signOut = useCallback(() => {
    setLocked(false);
    void logout();
  }, [logout]);

  useEffect(() => {
    const onBg = () => {
      bgAtRef.current = Date.now();
    };
    const onFg = () => {
      if (bgAtRef.current === null) bgAtRef.current = Date.now();
      const s = readSettings();
      if (s.enabled && Date.now() - bgAtRef.current >= s.autoLockSec * 1000) setLocked(true);
    };
    let handle: PluginListenerHandle | undefined;
    if (Capacitor.isNativePlatform()) {
      App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) onFg();
        else onBg();
      }).then((h) => {
        handle = h;
      });
    } else {
      const onVis = () => {
        if (document.hidden) onBg();
        else onFg();
      };
      document.addEventListener("visibilitychange", onVis);
    }
    // Keep the lockout countdown UI alive while it is showing.
    const ticker = window.setInterval(ping, 1000);
    return () => {
      if (handle) void handle.remove();
      window.clearInterval(ticker);
    };
  }, [ping]);

  const lockoutSecondsLeft = (() => {
    const s = settingsRef.current;
    if (s.wrongAttempts < LOCKOUT_AFTER_ATTEMPTS || !s.lastWrongAt) return 0;
    const left = Math.max(0, Math.ceil((s.lastWrongAt + LOCKOUT_SECONDS * 1000 - Date.now()) / 1000));
    if (left === 0 && settings.wrongAttempts >= LOCKOUT_AFTER_ATTEMPTS) return 0;
    return left;
  })();

  const value: AppLockContextValue = {
    enabled: settings.enabled,
    autoLockSec: settings.autoLockSec,
    locked,
    lockoutSecondsLeft,
    verify,
    enable,
    disable,
    changePin,
    lockNow,
    setAutoLockSec,
    signOut,
  };

  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>;
}

export function useAppLock(): AppLockContextValue {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error("useAppLock must be used within AppLockProvider");
  return ctx;
}