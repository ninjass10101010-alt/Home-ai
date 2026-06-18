'use client';

import { useState, useEffect, useCallback, createContext, useContext, ReactNode, useRef } from 'react';
import { db } from '@/db';
import { db as pbDb } from '@/db/pb-db';

const AUTH_STORAGE_KEY = 'consuela-auth-user';
const DEVICE_KEY = 'consuela-device-id';
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
const SESSION_WARN_MS = 30 * 1000;
const SESSION_TICK_MS = 1 * 1000;

function getDeviceId(): string {
  if (typeof window === 'undefined') return 'server';
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = 'dev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
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
  pin: string;
  avatarSize: string;
  glow: boolean;
}

interface AuthContextValue {
  currentUser: AuthUser | null;
  isLoggedIn: boolean;
  isParent: boolean;
  login: (memberName: string, pin: string) => { success: boolean; error?: string };
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
  const [sessionRemainingMs, setSessionRemainingMs] = useState<number>(INACTIVITY_TIMEOUT_MS);
  const [sessionWarning, setSessionWarning] = useState<boolean>(false);
  const currentUserRef = useRef<AuthUser | null>(null);
  const lastActivityRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const handleActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    setSessionWarning(false);
  }, []);

  const logout = useCallback(() => {
    setCurrentUser(null);
    currentUserRef.current = null;
    localStorage.removeItem(AUTH_STORAGE_KEY);
    setSessionWarning(false);
    setSessionRemainingMs(INACTIVITY_TIMEOUT_MS);

    // Remove PB session
    pbDb.deleteAuthSession(getDeviceId()).catch(() => {});
  }, []);

  const extendSession = useCallback(() => {
    lastActivityRef.current = Date.now();
    setSessionWarning(false);
    setSessionRemainingMs(INACTIVITY_TIMEOUT_MS);
  }, []);

  // Load persisted session + start inactivity timer on mount
  useEffect(() => {
    lastActivityRef.current = Date.now();

    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (stored) {
        const parsed: AuthUser = JSON.parse(stored);
        const members = db.selectMembersDetailed();
        const member = members.find((m: any) => memberMatchesName(m, parsed.name));
        if (member) {
          const hydrated = {
            ...parsed,
            emoji: parsed.emoji || member.emoji,
            avatarSize: member.avatarSize || parsed.avatarSize || "md",
            glow: Boolean(member.glow ?? parsed.glow),
          };
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setCurrentUser(hydrated);
          currentUserRef.current = hydrated;
        } else {
          localStorage.removeItem(AUTH_STORAGE_KEY);
        }
      } else {
        // Try PB restore
        pbDb.findAuthSession(getDeviceId()).then((session: any) => {
          if (session?.memberName) {
            const member = db.selectMembersDetailed().find((m: any) => memberMatchesName(m, session.memberName));
            if (member) {
              const members = db.selectMembers();
              const m = members.find((x: any) => memberMatchesName(x, session.memberName));
              const restored: AuthUser = {
                id: Number(m?.id) || 0,
                name: session.memberName,
                role: (member as any).role || 'child',
                emoji: (member as any).emoji || '👤',
                color: (member as any).color || 'amber',
                pin: '',
                avatarSize: (member as any).avatarSize || 'md',
                glow: Boolean((member as any).glow),
              };
              setCurrentUser(restored);
              currentUserRef.current = restored;
              localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(restored));
            }
          }
        }).catch(() => {});
      }
    } catch {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }

    const events = ['mousemove', 'keydown', 'touchstart', 'scroll', 'click', 'focus'];
    const handleMembersUpdated = () => {
      const activeUser = currentUserRef.current;
      if (!activeUser) return;

      const member = db.selectMembersDetailed().find((m: any) => memberMatchesName(m, activeUser.name));
      if (!member) return;

      const updatedUser: AuthUser = {
        ...activeUser,
        emoji: member.emoji || activeUser.emoji,
        color: member.color || activeUser.color,
        avatarSize: member.avatarSize || activeUser.avatarSize || "md",
        glow: Boolean(member.glow ?? activeUser.glow),
      };
      setCurrentUser(updatedUser);
      currentUserRef.current = updatedUser;
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
        ...updatedUser,
        emoji: updatedUser.emoji.startsWith('data:') ? '' : updatedUser.emoji,
      }));
    };
    events.forEach((event) => window.addEventListener(event, handleActivity));
    window.addEventListener("consuela-members-updated", handleMembersUpdated);

    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = Math.max(0, INACTIVITY_TIMEOUT_MS - elapsed);
      setSessionRemainingMs(remaining);
      if (remaining <= SESSION_WARN_MS) {
        setSessionWarning(true);
      }
      if (elapsed >= INACTIVITY_TIMEOUT_MS) {
        setCurrentUser(null);
        currentUserRef.current = null;
        setSessionRemainingMs(0);
        setSessionWarning(false);
        localStorage.removeItem(AUTH_STORAGE_KEY);
        pbDb.deleteAuthSession(getDeviceId()).catch(() => {});
      }
    }, SESSION_TICK_MS);

    return () => {
      events.forEach((event) => window.removeEventListener(event, handleActivity));
      window.removeEventListener("consuela-members-updated", handleMembersUpdated);
      clearTimers();
    };
  }, [handleActivity, clearTimers]);

  const login = useCallback((memberName: string, pin: string): { success: boolean; error?: string } => {
    const members = db.selectMembers();
    const detailedMembers = db.selectMembersDetailed();
    const member = members.find((m: any) => memberMatchesName(m, memberName));
    const detailedMember = detailedMembers.find((m: any) => memberMatchesName(m, memberName));
    if (!member) return { success: false, error: 'Member not found' };

    const verified = db.verifyMemberPin(memberName, pin);
    if (!verified) return { success: false, error: 'Incorrect PIN' };

    const authUser: AuthUser = {
      id: member.id,
      name: verified.name,
      role: verified.role,
      emoji: member.emoji,
      color: member.color,
      pin,
      avatarSize: detailedMember?.avatarSize || "md",
      glow: Boolean(detailedMember?.glow),
    };

    setCurrentUser(authUser);
    currentUserRef.current = authUser;
    lastActivityRef.current = Date.now();
    setSessionRemainingMs(INACTIVITY_TIMEOUT_MS);
    setSessionWarning(false);

    const stored = { ...authUser, emoji: (member.emoji && member.emoji.startsWith('data:')) ? '' : member.emoji };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(stored));

    // Persist session to PB for cross-device awareness
    pbDb.createAuthSession({
      token: getDeviceId(),
      memberName: verified.name,
      deviceName: navigator.platform || 'unknown',
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    }).catch(() => {});

    return { success: true };
  }, []);

  const isLoggedIn = currentUser !== null;
  const isParent = isLoggedIn && currentUser.role === 'parent';

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isLoggedIn,
        isParent,
        login,
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
