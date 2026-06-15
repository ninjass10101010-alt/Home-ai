"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import SoftButton from "@/components/ui/SoftButton";

interface ShareCardProps {
  open: boolean;
  memberName: string;
  memberEmoji: string;
  rank: number;
  points: number;
  onClose: () => void;
}

export default function ShareCard({ open, memberName, memberEmoji, rank, points, onClose }: ShareCardProps) {
  if (!open) return null;
  const firstName = memberName.split(" ")[0];
  const shareText = `${memberEmoji} ${firstName} is #${rank} this week with ${points} pts! 👑`;

  const handleCopy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(shareText);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Show Off!"
      description="Share your leaderboard achievement"
      footer={
        <>
          <SoftButton onClick={handleCopy} className="flex-1">Copy Text</SoftButton>
          <SoftButton variant="secondary" onClick={onClose} className="flex-1">Close</SoftButton>
        </>
      }
    >
      <div className="text-center py-6">
        <div className="text-6xl mb-4 animate-crown-glow">{memberEmoji}</div>
        <p className="text-2xl font-bold text-text-primary">
          #{rank}
        </p>
        <p className="text-lg text-text-secondary mt-1">
          {firstName} — {points} points this week
        </p>
        <div className="mt-4 rounded-2xl bg-white/5 px-4 py-3 text-sm text-text-muted">
          {shareText}
        </div>
      </div>
    </Modal>
  );
}