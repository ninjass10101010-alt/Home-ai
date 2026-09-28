"use client";

import type { ReactNode } from "react";
import Modal from "@/components/ui/Modal";
import NavIcon from "@/components/ui/NavIcon";
import SoftButton from "@/components/ui/SoftButton";
import MoreMenuItem from "@/components/patterns/MoreMenuItem";
import { useAuth } from "@/hooks/useAuth";
import { moreNavItemsForRole, navRoleForUser } from "@/lib/nav-items";

/**
 * The Home "More…" sheet — the secondary half of `lib/nav-items.ts`.
 *
 * Phase 3 of the 2026-09 UI audit: five features had **zero** inbound links
 * (`/analytics`, `/memory`, `/money-mountain`, `/skill-tree`, `/time-capsule` —
 * plus `/grocery`, which only the design-system demo page linked). Real API and
 * data surface for screens nobody could navigate to, which in an assistant-first
 * product also means Consuela never surfaces them. They live here now, and role
 * filtering means a child never sees the parent-only family memory bank or the
 * finance pages that the signed-out wall would otherwise expose.
 *
 * Rows come from the manifest, so adding a destination is a one-line change
 * there — never a new list here.
 */
interface MoreSheetProps {
  open: boolean;
  onClose: () => void;
  /** Action rows appended after the route manifest (audit 4.5): Home folds its
   *  below-the-fold widgets behind a "Show all widgets" row here. */
  extraItems?: MoreExtraItem[];
}

export interface MoreExtraItem {
  key: string;
  title: string;
  description?: string;
  icon: ReactNode;
  badge?: string;
  onSelect: () => void;
}

export default function MoreSheet({ open, onClose, extraItems }: MoreSheetProps) {
  const { currentUser } = useAuth();
  const role = navRoleForUser(currentUser);
  const items = moreNavItemsForRole(role);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="More"
      description="Everything else around the house"
      panelClassName="max-w-lg"
    >
      <div className="grid gap-3" data-more-sheet="true" data-more-role={role}>
        {items.map((item) => (
          <MoreMenuItem
            key={item.path}
            href={item.path}
            title={item.label}
            description={item.description}
            icon={<NavIcon iconKey={item.iconKey} className="h-6 w-6" />}
          />
        ))}
        {extraItems?.map((item) => (
          <MoreMenuItem
            key={item.key}
            title={item.title}
            description={item.description}
            badge={item.badge}
            icon={item.icon}
            onSelect={item.onSelect}
          />
        ))}
      </div>
    </Modal>
  );
}

/**
 * The trigger. Kept here so every Home mode opens the same sheet with the same
 * words and the same ARIA contract; the caller owns placement and open state.
 */
export function MoreButton({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <SoftButton
      variant="secondary"
      className={className}
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label="More destinations"
    >
      More…
    </SoftButton>
  );
}
