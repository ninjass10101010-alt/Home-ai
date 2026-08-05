"use client";

import PageShell from "@/components/ui/PageShell";
import PageHeader from "@/components/patterns/PageHeader";
import MoreMenuItem from "@/components/patterns/MoreMenuItem";
import Surface from "@/components/ui/Surface";

export default function MorePage() {
  return (
    <PageShell>
      <PageHeader title="More" subtitle="Calendar, Grocery, and Emergency reference tools" />
      <div className="px-4 space-y-4 pb-8">
        <Surface variant="warm" radius="2xl" padding="lg">
          <div className="grid gap-3">
            <MoreMenuItem icon="📅" title="Calendar" description="Family routines, events, and month view" href="/calendar" />
            <MoreMenuItem icon="🛒" title="Grocery" description="Smart grocery list with pantry sync" href="/meals?tab=grocery" badge="Synced" />
            <MoreMenuItem icon="🛡️" title="Emergency" description="Non-critical contact reference" href="/emergency" />
          </div>
        </Surface>

        <Surface variant="glass-subtle" radius="xl" padding="lg">
          <h3 className="text-sm font-bold text-text-primary">Why these are in More</h3>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            Home, Ask Consuela, Meals, Tasks, and Settings are the five primary family workflows. Calendar, Grocery, and Emergency stay one tap away here to keep the bottom bar calm and thumb-friendly.
          </p>
        </Surface>
      </div>
    </PageShell>
  );
}
