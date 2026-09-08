import type { Metadata } from "next";
import { composeScreensaverPayload } from "@/lib/screensaver/payload";
import { ScreensaverBoard } from "@/components/screensaver/ScreensaverBoard";

export const metadata: Metadata = {
  title: "Consuela — Screensaver",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ScreensaverPage() {
  const initial = await composeScreensaverPayload().catch(() => null);
  return <ScreensaverBoard initial={initial} />;
}
