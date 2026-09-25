"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import SettingsErrorBoundary from "@/components/ui/SettingsErrorBoundary";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <SettingsErrorBoundary key={pathname}>{children}</SettingsErrorBoundary>;
}
