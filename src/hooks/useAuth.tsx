'use client';

import { useState, useEffect, useCallback, createContext, useContext, ReactNode, useRef } from 'react';
import { db } from '@/db';

const AUTH_STORAGE_KEY = 'consuela-auth-user';
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
const INACTIVITY_CHECK_INTERVAL_MS = 10 * 1000;

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
  const currentUserRef = useRef<AuthUser | null>(null);
  const lastActivityRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      }
    } catch {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }

    const events = ['mousemove', 'keydown', 'touchstart', 'scroll', 'click', 'focus'];
    const handleActivity = () => { lastActivityRef.current = Date.now(); };
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
        if (elapsed >= INACTIVITY_TIMEOUT_MS) {
          setCurrentUser(null);
          currentUserRef.current = null;
          localStorage.removeItem(AUTH_STORAGE_KEY);
        }
    }, INACTIVITY_CHECK_INTERVAL_MS);

    return () => {
      events.forEach((event) => window.removeEventListener(event, handleActivity));
      window.removeEventListener("consuela-members-updated", handleMembersUpdated);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

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

    const stored = { ...authUser, emoji: (member.emoji && member.emoji.startsWith('data:')) ? '' : member.emoji };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(stored));
    return { success: true };
  }, []);

  const logout = useCallback(() => {
    setCurrentUser(null);
    currentUserRef.current = null;
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }, []);

  const isLoggedIn = currentUser !== null;
  const isParent = isLoggedIn && currentUser.role === 'parent';

  return (
    <AuthContext.Provider value={{ currentUser, isLoggedIn, isParent, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
