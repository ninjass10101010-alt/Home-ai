"use client";

import { motion } from "framer-motion";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  glow?: boolean;
  animated?: boolean;
}

export default function Card({
  children,
  className = "",
  onClick,
  glow = true,
  animated = true,
}: CardProps) {
  const base =
    "rounded-2xl glass p-4 transition-all duration-300 will-change-transform";
  const glowClass = glow ? "widget-glow" : "";
  const transformClass = animated ? "isometric-card" : "";

  const motionProps = animated
    ? {
        whileHover: { scale: 1.02, y: -4 },
        whileTap: { scale: 0.98 },
        transition: { type: "spring", stiffness: 400, damping: 17 },
      }
    : {};

  if (onClick) {
    return (
      <motion.button
        type="button"
        onClick={onClick}
        className={`${base} ${glowClass} ${transformClass} cursor-pointer hover:border-nori-500/30 ${className} w-full text-left`}
        {...(motionProps as any)}
      >
        {children}
      </motion.button>
    );
  }

  return (
    <motion.div
      className={`${base} ${glowClass} ${transformClass} ${className}`}
      {...(motionProps as any)}
    >
      {children}
    </motion.div>
  );
}