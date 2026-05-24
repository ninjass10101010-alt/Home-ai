"use client";

import React from "react";

interface AnimatedEmojiProps {
  emoji: string;
  name?: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const sizeMap = {
  sm: 24,
  md: 32,
  lg: 48,
  xl: 64,
};

export default function AnimatedEmoji({ emoji, name, size = "md", className = "" }: AnimatedEmojiProps) {
  const s = sizeMap[size];
  const cx = s / 2;
  const cy = s / 2;

  // Render specific animal animations based on emoji or name
  if (emoji === "🐶" || name?.toLowerCase().includes("frenchie") || name?.toLowerCase().includes("buster") || name?.toLowerCase().includes("rocco")) {
    return (
      <svg width={s} height={s} viewBox="0 0 64 64" fill="none" className={className}>
        <style>{`
          @keyframes frenchieEarL {
            0%, 100% { transform: rotate(0deg); }
            5% { transform: rotate(-5deg); }
            10% { transform: rotate(2deg); }
            15% { transform: rotate(0deg); }
          }
          @keyframes frenchieEarR {
            0%, 100% { transform: rotate(0deg); }
            50% { transform: rotate(5deg); }
            55% { transform: rotate(-2deg); }
            60% { transform: rotate(0deg); }
          }
          @keyframes pant {
            0%, 100% { transform: translateY(0) scaleY(1); }
            50% { transform: translateY(1px) scaleY(1.1); }
          }
        `}</style>
        {/* Face */}
        <ellipse cx="32" cy="38" rx="22" ry="18" fill="#a3a3a3" />
        <path d="M14 38 Q32 58 50 38" fill="#737373" />
        {/* Left Ear */}
        <g style={{ transformOrigin: "20px 25px", animation: "frenchieEarL 4s infinite" }}>
          <path d="M12 28 Q8 10 18 8 Q24 8 26 22 Z" fill="#a3a3a3" />
          <path d="M15 26 Q12 12 18 10 Q21 10 23 21 Z" fill="#fbcfe8" />
        </g>
        {/* Right Ear */}
        <g style={{ transformOrigin: "44px 25px", animation: "frenchieEarR 5s infinite 2s" }}>
          <path d="M52 28 Q56 10 46 8 Q40 8 38 22 Z" fill="#262626" />
          <path d="M49 26 Q52 12 46 10 Q43 10 41 21 Z" fill="#fbcfe8" />
        </g>
        {/* Eye patch */}
        <ellipse cx="44" cy="32" rx="9" ry="8" fill="#262626" />
        {/* Eyes */}
        <circle cx="20" cy="32" r="3.5" fill="#262626" />
        <circle cx="19" cy="31" r="1.5" fill="white" />
        <circle cx="44" cy="32" r="3.5" fill="white" />
        <circle cx="43" cy="31" r="1.5" fill="#262626" />
        {/* Nose */}
        <ellipse cx="32" cy="40" rx="5" ry="3" fill="#262626" />
        {/* Mouth/Tongue */}
        <path d="M32 43 Q32 46 27 45" stroke="#262626" strokeWidth="1.5" fill="none" />
        <path d="M32 43 Q32 46 37 45" stroke="#262626" strokeWidth="1.5" fill="none" />
        <g style={{ animation: "pant 0.25s infinite alternate", transformOrigin: "32px 45px" }}>
          <path d="M30 45 Q32 52 34 45 Z" fill="#f43f5e" />
        </g>
      </svg>
    );
  }

  if (emoji === "🐩" || name?.toLowerCase().includes("poodle") || name?.toLowerCase().includes("coco") || name?.toLowerCase().includes("rico")) {
    return (
      <svg width={s} height={s} viewBox="0 0 64 64" fill="none" className={className}>
        <style>{`
          @keyframes poodleBounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-2px); }
          }
          @keyframes wag {
            0%, 100% { transform: rotate(0deg); }
            25% { transform: rotate(-8deg); }
            75% { transform: rotate(8deg); }
          }
        `}</style>
        <g style={{ animation: "poodleBounce 1s infinite ease-in-out" }}>
          {/* Muzzle */}
          <ellipse cx="32" cy="42" rx="14" ry="10" fill="#404040" />
          {/* Head floof */}
          <circle cx="32" cy="24" r="12" fill="#262626" />
          <circle cx="24" cy="28" r="9" fill="#262626" />
          <circle cx="40" cy="28" r="9" fill="#262626" />
          {/* Ears */}
          <g style={{ transformOrigin: "20px 32px", animation: "wag 0.8s infinite ease-in-out" }}>
            <ellipse cx="16" cy="40" rx="6" ry="12" fill="#262626" />
          </g>
          <g style={{ transformOrigin: "44px 32px", animation: "wag 0.8s infinite ease-in-out reverse" }}>
            <ellipse cx="48" cy="40" rx="6" ry="12" fill="#262626" />
          </g>
          {/* Nose */}
          <circle cx="32" cy="38" r="4" fill="#000000" />
          {/* Eyes */}
          <circle cx="26" cy="32" r="2.5" fill="#171717" />
          <circle cx="25" cy="31" r="1" fill="white" />
          <circle cx="38" cy="32" r="2.5" fill="#171717" />
          <circle cx="37" cy="31" r="1" fill="white" />
        </g>
      </svg>
    );
  }

  if (emoji === "🐟" || name?.toLowerCase().includes("fish") || name?.toLowerCase().includes("bubbles")) {
    return (
      <svg width={s} height={s} viewBox="0 0 64 64" fill="none" className={className}>
        <style>{`
          @keyframes swim {
            0%, 100% { transform: translateY(0) translateX(0); }
            50% { transform: translateY(-4px) translateX(2px); }
          }
          @keyframes tailFlip {
            0%, 100% { transform: scaleX(1); }
            50% { transform: scaleX(0.5); }
          }
          @keyframes bubbleUp {
            0% { transform: translateY(0) scale(0.5); opacity: 0; }
            50% { opacity: 1; }
            100% { transform: translateY(-20px) scale(1.2); opacity: 0; }
          }
        `}</style>
        {/* Bubbles */}
        <circle cx="48" cy="30" r="3" fill="#67e8f9" opacity="0" style={{ animation: "bubbleUp 2s infinite linear" }} />
        <circle cx="52" cy="20" r="2" fill="#67e8f9" opacity="0" style={{ animation: "bubbleUp 2s infinite linear 1s" }} />
        
        <g style={{ animation: "swim 3s infinite ease-in-out" }}>
          {/* Tail */}
          <g style={{ transformOrigin: "16px 32px", animation: "tailFlip 0.5s infinite alternate" }}>
            <path d="M18 32 L4 20 L4 44 Z" fill="#f97316" />
          </g>
          {/* Fins */}
          <path d="M32 20 L26 10 L38 10 Z" fill="#ea580c" />
          <path d="M32 44 L26 54 L38 54 Z" fill="#ea580c" />
          {/* Body */}
          <ellipse cx="34" cy="32" rx="18" ry="12" fill="#f97316" />
          <ellipse cx="38" cy="32" rx="14" ry="10" fill="#fb923c" />
          {/* Eye */}
          <circle cx="44" cy="28" r="4" fill="white" />
          <circle cx="45" cy="28" r="2" fill="#1e3a8a" />
          <circle cx="46" cy="27" r="0.8" fill="white" />
          {/* Mouth */}
          <path d="M48 34 Q52 36 48 38" stroke="#ea580c" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
      </svg>
    );
  }

  // Dashboard Common Icons
  if (emoji === "⚽") {
    return (
      <svg width={s} height={s} viewBox="0 0 64 64" fill="none" className={className}>
        <style>{`
          @keyframes roll {
            0% { transform: translateX(-4px) rotate(-15deg); }
            50% { transform: translateX(4px) rotate(15deg); }
            100% { transform: translateX(-4px) rotate(-15deg); }
          }
        `}</style>
        <g style={{ transformOrigin: "32px 32px", animation: "roll 2s infinite ease-in-out" }}>
          <circle cx="32" cy="32" r="20" fill="white" stroke="#262626" strokeWidth="2" />
          <path d="M32 18 L24 28 L28 40 L36 40 L40 28 Z" fill="#262626" />
          <path d="M24 28 L12 24 L14 36 L28 40" stroke="#262626" strokeWidth="2" fill="none" strokeLinejoin="round" />
          <path d="M40 28 L52 24 L50 36 L36 40" stroke="#262626" strokeWidth="2" fill="none" strokeLinejoin="round" />
          <path d="M32 18 L24 12" stroke="#262626" strokeWidth="2" fill="none" strokeLinejoin="round" />
          <path d="M32 18 L40 12" stroke="#262626" strokeWidth="2" fill="none" strokeLinejoin="round" />
        </g>
      </svg>
    );
  }

  if (emoji === "🍽️") {
    return (
      <svg width={s} height={s} viewBox="0 0 64 64" fill="none" className={className}>
        <style>{`
          @keyframes clink {
            0%, 100% { transform: rotate(0deg); }
            50% { transform: rotate(15deg); }
          }
        `}</style>
        <circle cx="32" cy="32" r="18" fill="#e5e5e5" stroke="#a3a3a3" strokeWidth="2" />
        <circle cx="32" cy="32" r="12" fill="white" />
        <g style={{ transformOrigin: "16px 32px", animation: "clink 1.5s infinite ease-in-out alternate" }}>
          <path d="M18 16 L18 48 M14 16 L14 32 Q14 36 18 36 Q22 36 22 32 L22 16 M18 36 L18 48" stroke="#737373" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <path d="M46 16 L46 48 M46 16 C40 16 40 32 46 32" stroke="#737373" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  // Fallback to text emoji with a bouncy animation
  return (
    <div
      className={`inline-flex items-center justify-center ${className}`}
      style={{
        width: s,
        height: s,
        fontSize: s * 0.7,
        animation: "popBounce 2s infinite",
        transformOrigin: "center bottom",
      }}
    >
      <style>{`
        @keyframes popBounce {
          0%, 100% { transform: scale(1) translateY(0); }
          10% { transform: scale(1.1, 0.9) translateY(2px); }
          30% { transform: scale(0.9, 1.1) translateY(-6px); }
          50% { transform: scale(1.05, 0.95) translateY(0); }
          57% { transform: scale(1) translateY(-2px); }
          64% { transform: scale(1) translateY(0); }
        }
      `}</style>
      {emoji}
    </div>
  );
}
