"use client";

export default function SettingsSectionLoading() {
  return (
    <section
      data-settings-section-loading="true"
      aria-busy="true"
      aria-label="Loading settings section"
      className="rounded-3xl border border-white/10 bg-[var(--color-surface-0)]/35 p-6"
    >
      <p className="text-sm text-text-secondary">Loading settings…</p>
    </section>
  );
}
