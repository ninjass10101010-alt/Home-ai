"use client";

import AppearanceSection from "@/components/settings/AppearanceSection";
import FogSection from "@/components/settings/FogSection";
import SectionCard from "@/components/patterns/SectionCard";

export default function AppearanceSettingsSection() {
  return (
    <section aria-label="Appearance settings" data-settings-appearance="true" className="space-y-5">
      <SectionCard
        title="Theme & accent"
        description="Theme, accent, and contrast controls"
        icon="🎨"
        headingLevel="h2"
      >
        <AppearanceSection />
      </SectionCard>
      <SectionCard
        title="Home background"
        description="Fog and particle effects behind the Home dashboard"
        icon="☁️"
        headingLevel="h2"
      >
        <FogSection />
      </SectionCard>
    </section>
  );
}
