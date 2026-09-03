"use client";

import Modal from "@/components/ui/Modal";
import Avatar from "@/components/ui/Avatar";
import SoftButton from "@/components/ui/SoftButton";
import { normalizeAvatarSize } from "@/lib/avatar-size";

export interface PickerMember {
  name: string;
  emoji?: string;
  color?: string;
  avatarSize?: string;
  glow?: boolean;
  role?: string;
}

interface MemberPickerModalProps {
  open: boolean;
  members: PickerMember[];
  onSelect: (member: PickerMember) => void;
  onClose: () => void;
}

export default function MemberPickerModal({ open, members, onSelect, onClose }: MemberPickerModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Who&apos;s signing in?" description="Pick a family member, then enter their PIN.">
      <div className="grid max-h-[55vh] grid-cols-3 gap-2 overflow-y-auto pb-1 sm:grid-cols-4">
        {members.map((member) => (
          <button
            key={member.name}
            type="button"
            onClick={() => onSelect(member)}
            className="tap flex flex-col items-center gap-1.5 rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-2 py-3 text-center transition hover:border-white/25 hover:bg-[var(--color-surface-2)]/80 active:scale-95"
          >
            <Avatar
              name={member.name}
              color={member.color || "green"}
              emoji={member.emoji || "😊"}
              size={normalizeAvatarSize(member.avatarSize)}
              variant="emoji"
              glow={member.glow}
            />
            <span className="text-xs font-semibold leading-tight text-text-primary">{member.name.split(" ")[0]}</span>
            <span className="text-[10px] capitalize leading-tight text-text-muted">{member.role || "member"}</span>
          </button>
        ))}
      </div>
      <div className="mt-4">
        <SoftButton variant="secondary" onClick={onClose} className="w-full">
          Cancel
        </SoftButton>
      </div>
    </Modal>
  );
}
