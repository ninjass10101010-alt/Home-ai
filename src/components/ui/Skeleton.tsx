"use client";

interface SkeletonProps {
  variant?: "text" | "title" | "block" | "avatar" | "card";
  className?: string;
}

export default function Skeleton({ variant = "text", className = "" }: SkeletonProps) {
  const variantMap = {
    text: "h-3 w-full rounded-full",
    title: "h-5 w-2/3 rounded-xl",
    block: "h-24 w-full rounded-2xl",
    avatar: "h-12 w-12 rounded-full",
    card: "h-40 w-full rounded-3xl",
  };

  return <div className={`animate-pulse bg-[var(--color-surface-3)] ${variantMap[variant]} ${className}`} />;
}
