import PageHeader from "@/components/patterns/PageHeader";
import PageShell from "@/components/ui/PageShell";

export default function SettingsNotFound() {
  return (
    <PageShell>
      <div data-settings-surface="true">
        <PageHeader title="Settings" backHref="/settings" backLabel="Back to Settings" icon="⚙️" />
        <section className="px-4 pb-8" aria-labelledby="settings-not-found-heading">
          <div className="rounded-3xl border border-white/10 bg-[var(--color-surface-0)]/35 p-6">
            <h2 id="settings-not-found-heading" className="text-lg font-bold text-text-primary">
              Settings section not found
            </h2>
            <p className="mt-2 text-sm leading-6 text-text-secondary">That Settings section does not exist.</p>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
