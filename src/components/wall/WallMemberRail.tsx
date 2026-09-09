"use client";

import { useState } from "react";
import Avatar from "@/components/ui/Avatar";

// Local mirror of page.tsx's memberMatchesName — no shared lib export exists.
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

/** Wall header member rail — always-visible identity + auth (spec §5).
 *  Tiles ~80px with names; signed-in tile glows; inline two-tap sign-out. */
export default function WallMemberRail({
  members,
  currentUser,
  isLoggedIn,
  onPick,
  onSelfProfile,
  onSignOut,
}: {
  members: any[];
  currentUser: { name: string } | null;
  isLoggedIn: boolean;
  onPick: (member: any) => void;
  onSelfProfile: () => void;
  onSignOut: () => void;
}) {
  const [arming, setArming] = useState(false);

  return (
    <div className="flex flex-wrap items-center justify-end gap-2" data-testid="wall-member-rail">
      {members.map((member) => {
        const isSelf = Boolean(isLoggedIn && currentUser && memberMatchesName(member, currentUser.name));
        return (
          <button
            key={member.name}
            type="button"
            aria-label={isSelf ? "Open your profile" : `Sign in as ${member.name}`}
            aria-current={isSelf ? "true" : undefined}
            onClick={() => (isSelf ? onSelfProfile() : onPick(member))}
            className={`tap flex w-[80px] flex-col items-center gap-1 rounded-2xl border p-2 ${
              isSelf
                ? "border-[var(--color-accent-selected)]/60 bg-[var(--color-accent-selected)]/15"
                : "border-white/10 bg-[var(--color-surface-0)]/25"
            }`}
          >
            <Avatar name={member.name} color={member.color} emoji={member.emoji} size="lg" variant="emoji" glow={member.glow} />
            <span className={`w-full truncate text-center text-[13px] font-semibold ${isSelf ? "text-[var(--color-accent-selected)]" : "text-text-secondary"}`}>
              {isSelf ? "✓ " : ""}{member.name.split(" ")[0]}
            </span>
          </button>
        );
      })}
      {isLoggedIn && (
        arming ? (
          <button
            type="button"
            aria-label="Confirm sign out"
            onClick={() => { setArming(false); onSignOut(); }}
            onBlur={() => setArming(false)}
            className="tap h-16 rounded-2xl bg-[var(--color-accent-rose)] px-4 text-base font-bold text-white"
          >
            Sign out?
          </button>
        ) : (
          <button
            type="button"
            aria-label="Sign out"
            onClick={() => setArming(true)}
            className="tap h-16 rounded-2xl border border-white/10 bg-[var(--color-surface-0)]/25 px-4 text-base font-semibold text-text-secondary hover:text-text-primary"
          >
            Sign out
          </button>
        )
      )}
    </div>
  );
}
