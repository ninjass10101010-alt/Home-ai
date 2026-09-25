import Link from "next/link";
import type { SettingsSectionDefinition, SettingsSectionId } from "@/lib/settings-sections";

export type SettingsStatusOverrides = Partial<Record<SettingsSectionId, string>>;

export interface SettingsLauncherProps {
  sections: readonly SettingsSectionDefinition[];
  statusOverrides?: SettingsStatusOverrides;
}

export default function SettingsLauncher({ sections, statusOverrides = {} }: SettingsLauncherProps) {
  return (
    <nav aria-label="Settings sections" data-settings-launcher="true" data-settings-surface="true" className="settings-launcher px-4 pb-8">
      <ul
        data-settings-launcher-grid="true"
        className="settings-launcher-grid grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2"
      >
        {sections.map((section) => {
          const status = statusOverrides[section.id] ?? section.description;

          return (
            <li key={section.id} className="min-w-0">
              <Link
                 href={`/settings/${section.id}`}
                 prefetch={false}
                 data-settings-section={section.id}
                className="settings-launcher-card widget-card tap min-h-44 p-5 text-left"
              >
                <span
                  aria-hidden="true"
                  data-settings-icon="true"
                  className="text-4xl leading-none"
                >
                  {section.icon}
                </span>
                <span className="mt-5 flex min-w-0 flex-1 flex-col">
                  <h2 className="text-lg font-bold text-text-primary">{section.title}</h2>
                  <span data-settings-status="true" className="mt-1 text-sm text-text-secondary">
                    {status}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  data-settings-chevron="true"
                  className="ml-3 self-end text-2xl text-text-muted"
                >
                  ›
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
