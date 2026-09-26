"use client";

import type { AllTimeReadState } from "@/hooks/useAllTimeTotals";
import { OFFLINE_LABEL, UNAVAILABLE_LABEL, LOADING_LABEL, formatAllTimeStamp } from "./level";

interface AllTimeValueProps {
  points: number | null | undefined;
  read: AllTimeReadState;
  updatedAt: string | null;
  label?: string;
  className?: string;
}

export default function AllTimeValue({
  points,
  read,
  updatedAt,
  label = "all-time",
  className,
}: AllTimeValueProps) {
  if (read === "loading") return <span className={className}>{LOADING_LABEL}</span>;
  if (typeof points !== "number") return <span className={className}>{UNAVAILABLE_LABEL}</span>;
  return (
    <span className={className}>
      {points} {label}
      {read === "offline_cache" && updatedAt ? (
        <>
          {" · "}
          <time dateTime={updatedAt}>
            {OFFLINE_LABEL} {formatAllTimeStamp(updatedAt)}
          </time>
        </>
      ) : null}
    </span>
  );
}
