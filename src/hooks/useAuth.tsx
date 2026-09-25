'use client';

import { useState, useEffect, useCallback, createContext, useContext, ReactNode, useRef } from 'react';
import { db } from '@/db';
import { flushPendingWrites } from '@/lib/pending-writes';
import { isSessionRole, sessionTtlSeconds, type SessionRole } from '@/lib/session-policy';
import {
  requestTaskOutboxFlush,
  warnTaskOutboxFlushFailure,
} from '@/lib/task-operation-outbox';

const AUTH_STORAGE_KEY = 'consuela-auth-user';
const TOUCH_THROTTLE_MS = 60 * 1000;
const TOUCH_ATTEMPT_FLOOR_MS = 10 * 1000;
const DEFAULT_REMAINING_MS = sessionTtlSeconds('parent') * 1000;
// Kids warn for a full 5 minutes instead of 30s so the flip never surprises a
// child.
const SESSION_WARN_MS = 30 * 1000;
const KID_SESSION_WARN_MS = 5 * 60 * 1000;
const SESSION_TICK_MS = 1 * 1000;

function isKidRole(role?: string) {
  return role === 'child' || role === 'pet';
}

function memberMatchesName(member: any, name: string) {
  const firstName = name.split(" ")[0];
  return (
    member.name === name ||
    member.name.startsWith(`${name} `) ||
    member.name.split(" ")[0] === name ||
    member.name === firstName ||
    firstName.startsWith(member.name)
  );
}

export interface AuthUser {
  id: number;
  name: string;
  role: 'parent' | 'child' | 'pet';
  emoji: string;
  color: string;
  avatarSize: string;
  glow: boolean;
  age?: number;
}

interface AuthContextValue {
  currentUser: AuthUser | null;
  isLoggedIn: boolean;
  isParent: boolean;
  login: (memberName: string, pin: string) => Promise<{ success: boolean; error?: string }>;
  quickLogin: (memberName: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  sessionRemainingMs: number;
  sessionWarning: boolean;
  extendSession: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [sessionRemainingMs, setSessionRemainingMs] = useState<number>(DEFAULT_REMAINING_MS);
  const [sessionWarning, setSessionWarning] = useState<boolean>(false);
  const currentUserRef = useRef<AuthUser | null>(null);
  const lastActivityAtRef = useRef<number>(0);
  const lastSuccessfulTouchAtRef = useRef<number>(0);
  const lastAttemptAtRef = useRef<number>(0);
  const lastAttemptFailedRef = useRef<boolean>(false);
  const touchInFlightRef = useRef<boolean>(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const logout = useCallback(() => {
    // MF-1 — clear the httpOnly session cookie too: localStorage cleanup alone
    // left the server session alive (≤7d) on shared devices. Fire-and-forget so
    // sign-out never blocks or fails on a dead network.
    fetch("/api/auth/logout", { method: "POST" }).catch(() => {});

    setCurrentUser(null);
    currentUserRef.current = null;
    lastSuccessfulTouchAtRef.current = 0;
    lastAttemptAtRef.current = 0;
    lastAttemptFailedRef.current = false;
    localStorage.removeItem(AUTH_STORAGE_KEY);
    setSessionWarning(false);
    setSessionRemainingMs(DEFAULT_REMAINING_MS);
  }, []);

  const adoptTouchedRole = useCallback((role: SessionRole) => {
    const active = currentUserRef.current;
    if (!active || active.role === role) return;
    const updated: AuthUser = { ...active, role };
    currentUserRef.current = updated;
    setCurrentUser(updated);
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      parsed.role = role;
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(parsed));
    } catch {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  }, []);

  const touchSession = useCallback(async (force = false) => {
    if (!currentUserRef.current) return;
    if (touchInFlightRef.current) return;
    const now = Date.now();
    if (!force && now - lastSuccessfulTouchAtRef.current < TOUCH_THROTTLE_MS) return;
    if (!force && lastAttemptFailedRef.current && now - lastAttemptAtRef.current < TOUCH_ATTEMPT_FLOOR_MS) return;

    lastAttemptAtRef.current = now;
    lastAttemptFailedRef.current = true;
    touchInFlightRef.current = true;
    try {
      const response = await fetch("/api/auth/touch", { method: "POST" });
      if (response.status === 200) {
        lastSuccessfulTouchAtRef.current = Date.now();
        lastAttemptFailedRef.current = false;
        setSessionWarning(false);
        const body = await response.json().catch(() => null) as { member?: { role?: unknown } } | null;
        const touchedRole = body?.member?.role;
        if (isSessionRole(touchedRole)) adoptTouchedRole(touchedRole);
      } else if (response.status === 401 || response.status === 403) {
        logout();
      }
    } catch {
    } finally {
      touchInFlightRef.current = false;
    }
  }, [adoptTouchedRole, logout]);

  const handleActivity = useCallback(() => {
    lastActivityAtRef.current = Date.now();
    setSessionWarning(false);
    void touchSession();
  }, [touchSession]);

  const extendSession = useCallback(() => {
    lastActivityAtRef.current = Date.now();
    setSessionWarning(false);
    setSessionRemainingMs(sessionTtlSeconds(currentUserRef.current?.role ?? "parent") * 1000);
    void touchSession(true);
  }, [touchSession]);

  // Load persisted session + start inactivity timer on mount
  useEffect(() => {
    lastActivityAtRef.current = Date.now();
    lastSuccessfulTouchAtRef.current = 0;
    lastAttemptAtRef.current = 0;
    lastAttemptFailedRef.current = false;

    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (stored) {
        const parsed: AuthUser = JSON.parse(stored);
        const member = db.selectMembersDetailed().find((m: any) => memberMatchesName(m, parsed.name));
        if (member && isSessionRole(parsed.role)) {
          const hydrated = {
            id: Number(parsed.id) || 0,
            name: parsed.name,
            role: parsed.role,
            emoji: parsed.emoji || member.emoji,
            color: parsed.color || 'amber',
            avatarSize: member.avatarSize || parsed.avatarSize || "md",
            glow: Boolean(member.glow ?? parsed.glow),
            age: Number.isFinite(Number((member as any).age)) && (member as any).age != null && (member as any).age !== ""
              ? Number((member as any).age)
              : parsed.age,
          };
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setCurrentUser(hydrated);
          currentUserRef.current = hydrated;
        } else {
          localStorage.removeItem(AUTH_STORAGE_KEY);
        }
      }
    } catch {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }

    const events = ['mousemove', 'keydown', 'touchstart', 'scroll', 'click', 'focus'];
    const handleMembersUpdated = () => {
      const activeUser = currentUserRef.current;
      if (!activeUser) return;

      const member = db.selectMembersDetailed().find((m: any) => memberMatchesName(m, activeUser.name));
      if (!member) {
        // The signed-in member was deleted from Settings — sign out gracefully.
        logout();
        return;
      }

      const updatedUser: AuthUser = {
        ...activeUser,
        emoji: member.emoji || activeUser.emoji,
        color: member.color || activeUser.color,
        avatarSize: member.avatarSize || activeUser.avatarSize || "md",
        glow: Boolean(member.glow ?? activeUser.glow),
        // "" fails closed to the previous value — Number("") is 0, which must
        // never masquerade as a real age (under-10 PIN-free path).
        age: member.age != null && member.age !== "" && Number.isFinite(Number(member.age))
          ? Number(member.age)
          : activeUser.age,
      };
      setCurrentUser(updatedUser);
      currentUserRef.current = updatedUser;
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
      id: updatedUser.id,
      name: updatedUser.name,
      role: updatedUser.role,
      emoji: updatedUser.emoji.startsWith('data:') ? '' : updatedUser.emoji,
      color: updatedUser.color,
      avatarSize: updatedUser.avatarSize,
      glow: updatedUser.glow,
      age: updatedUser.age,
    }));
    };
    events.forEach((event) => window.addEventListener(event, handleActivity));
    window.addEventListener("consuela-members-updated", handleMembersUpdated);

    intervalRef.current = setInterval(() => {
      const active = currentUserRef.current;
      if (!active) return;
      const now = Date.now();
      const ttlMs = sessionTtlSeconds(active.role) * 1000;
      const activityRemaining = ttlMs - (now - lastActivityAtRef.current);
      const touchRemaining = lastSuccessfulTouchAtRef.current === 0
        ? ttlMs
        : ttlMs - (now - lastSuccessfulTouchAtRef.current);
      const remainingMs = Math.max(
        0,
        Math.min(activityRemaining, touchRemaining),
      );
      setSessionRemainingMs(remainingMs);
      if (remainingMs <= (isKidRole(active.role) ? KID_SESSION_WARN_MS : SESSION_WARN_MS)) {
        setSessionWarning(true);
      }
      if (remainingMs === 0) {
        logout();
      }
    }, SESSION_TICK_MS);

    return () => {
      events.forEach((event) => window.removeEventListener(event, handleActivity));
      window.removeEventListener("consuela-members-updated", handleMembersUpdated);
      clearTimers();
    };
  }, [handleActivity, clearTimers, logout]);

  // Shared post-success flow for both sign-in paths (PIN login + quick login).
  // Factored verbatim out of login's original success block — same fields
  // stored, same session/flush side effects — so the two paths can never drift.
  const finishLogin = useCallback((member: any): { success: boolean; error?: string } => {
    if (!member?.name || !isSessionRole(member?.role)) {
      return { success: false, error: 'Sign-in failed' };
    }

    const authUser: AuthUser = {
      id: Number(member.id) || 0,
      name: member.name,
      role: member.role,
      emoji: member.emoji || '😊',
      color: member.color || 'amber',
      avatarSize: member.avatarSize || "md",
      glow: Boolean(member.glow),
      age: Number.isFinite(Number((member as any).age)) && (member as any).age != null && (member as any).age !== ""
        ? Number((member as any).age)
        : undefined,
    };

    setCurrentUser(authUser);
    currentUserRef.current = authUser;
    lastActivityAtRef.current = Date.now();
    lastSuccessfulTouchAtRef.current = 0;
    lastAttemptAtRef.current = 0;
    lastAttemptFailedRef.current = false;
    setSessionRemainingMs(sessionTtlSeconds(authUser.role) * 1000);
    setSessionWarning(false);

    const stored = {
      id: authUser.id,
      name: authUser.name,
      role: authUser.role,
      emoji: authUser.emoji.startsWith('data:') ? '' : authUser.emoji,
      color: authUser.color,
      avatarSize: authUser.avatarSize,
      glow: authUser.glow,
      age: authUser.age,
    };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(stored));

    // Session is now valid: drain the durable task-command outbox FIRST (a
    // queued claim/undo/approval/auth-required command has been waiting for a
    // real session), then replay queued meal/recipe writes and pull fresh
    // server data so other devices' changes appear without a reload.
    void requestTaskOutboxFlush()
      .catch(warnTaskOutboxFlushFailure)
      .then(() => flushPendingWrites())
      .then(() => db.refreshCaches());

    return { success: true };
  }, []);

  const login = useCallback(async (memberName: string, pin: string): Promise<{ success: boolean; error?: string }> => {
    // PIN verification happens server-side (POST /api/auth/login verifies
    // against PocketBase and sets an httpOnly session cookie). The client
    // never sees a pin — only the sanitized member record.
    let res: Response;
    try {
      res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberName, pin }),
      });
    } catch {
      return { success: false, error: 'Network error' };
    }
    if (!res.ok) return { success: false, error: 'Incorrect PIN' };

    let member: any;
    try {
      ({ member } = await res.json());
    } catch {
      return { success: false, error: 'Login failed' };
    }
    if (!member?.name) return { success: false, error: 'Login failed' };

    return finishLogin(member);
  }, [finishLogin]);

  const quickLogin = useCallback(async (memberName: string): Promise<{ success: boolean; error?: string }> => {
    // Server decides eligibility (role/age against PB); any non-200 falls
    // back to the normal PIN path. We never learn a PIN — there isn't one.
    let res: Response;
    try {
      res = await fetch("/api/auth/quick-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberName }),
      });
    } catch {
      return { success: false, error: "Network error" };
    }
    if (!res.ok) return { success: false, error: "PIN required" };
    let member: any;
    try { ({ member } = await res.json()); } catch { return { success: false, error: "Sign-in failed" }; }
    if (!member?.name) return { success: false, error: "Sign-in failed" };
    return finishLogin(member);
  }, [finishLogin]);

  const isLoggedIn = currentUser !== null;
  const isParent = isLoggedIn && currentUser.role === 'parent';

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isLoggedIn,
        isParent,
        login,
        quickLogin,
        logout,
        sessionRemainingMs,
        sessionWarning,
        extendSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
