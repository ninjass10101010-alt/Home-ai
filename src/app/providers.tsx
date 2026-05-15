"use client";

import { ToastProvider } from "@/components/ui/Toast";
import OpenClawDrive from "@/components/ui/OpenClawDrive";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      <OpenClawDrive />
      <ToastProvider>{children}</ToastProvider>
    </>
  );
}