"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "@/components/ui/Avatar";
import Chip from "@/components/ui/Chip";
import { normalizeAvatarSize } from "@/lib/avatar-size";

export interface FamilyStripMember {
  name: string;
  color: string;
  emoji: string;
  avatarSize: string;
  glow: boolean;
}

interface FamilyStripProps {
  members: FamilyStripMember[];
  /** True when `name` is the signed-in member — their circle opens the profile. */
  isSelf: (name: string) => boolean;
  onSelect: (member: FamilyStripMember) => void;
  onSelfProfile: () => void;
  onAddMember?: () => void;
  className?: string;
}

const FADE = "2.75rem";

/**
 * The family roster as a tappable circle run.
 *
 * **Why the mask is measured, not assumed.** The strip overflows on a phone
 * (nine members = 492px of content in a 358px scroller) and did not on a
 * laptop, so any fixed fade would have dimmed a complete roster at one width
 * and chopped a circle mid-face at another. A CSS mask cannot ask "is this
 * scrollable?", so the scroller measures `scrollWidth - clientWidth` and paints
 * a fade on exactly the edges that still have content behind them — the
 * overflow reads as a deliberate peek, and the left edge lights up as soon as
 * the run is scrolled away from home.
 */
export default function FamilyStrip({
  members,
  isSelf,
  onSelect,
  onSelfProfile,
  onAddMember,
  className = "",
}: FamilyStripProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });

  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const overflow = el.scrollWidth - el.clientWidth;
    const next = { left: el.scrollLeft > 2, right: overflow - el.scrollLeft > 2 };
    setEdges((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    for (const child of Array.from(el.children)) observer?.observe(child);
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [measure, members.length]);

  const maskImage =
    edges.left && edges.right
      ? `linear-gradient(to right, transparent 0, #000 ${FADE}, #000 calc(100% - ${FADE}), transparent 100%)`
      : edges.left
        ? `linear-gradient(to right, transparent 0, #000 ${FADE}, #000 100%)`
        : edges.right
          ? `linear-gradient(to right, #000 0, #000 calc(100% - ${FADE}), transparent 100%)`
          : undefined;

  const fade = edges.left && edges.right ? "both" : edges.left ? "left" : edges.right ? "right" : "none";

  return (
    <div className={className}>
      <div
        ref={scrollerRef}
        // `data-strip-fade` mirrors the mask. jsdom's CSSOM drops
        // `mask-image` (it implements no such property), so the state hook is
        // what makes the fade observable in jsdom and testable at all.
        data-strip-fade={fade}
        className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={maskImage ? ({ maskImage, WebkitMaskImage: maskImage }) : undefined}
      >
        {members.map((member) => (
          <button
            key={member.name}
            type="button"
            aria-label={isSelf(member.name) ? "Open your profile" : `Sign in as ${member.name}`}
            onClick={() => (isSelf(member.name) ? onSelfProfile() : onSelect(member))}
            className="min-h-11 min-w-11 flex items-center justify-center active:scale-90 transition-transform"
          >
            <Avatar
              name={member.name}
              color={member.color}
              emoji={member.emoji}
              size={normalizeAvatarSize(member.avatarSize)}
              variant="emoji"
              glow={member.glow}
            />
          </button>
        ))}
        {onAddMember && (
          <Chip
            tone="accent"
            className="h-12 w-12 min-w-12 shrink-0 !px-0 text-lg"
            aria-label="Add a family member"
            title="Add a family member"
            onClick={onAddMember}
          >
            ＋
          </Chip>
        )}
      </div>
    </div>
  );
}
