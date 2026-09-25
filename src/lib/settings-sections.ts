export type SettingsSectionId = "me" | "family" | "safety" | "appearance" | "home" | "system";

export type SettingsRole = "guest" | "parent" | "child" | "pet";

export interface SettingsSectionDefinition {
  id: SettingsSectionId;
  title: string;
  description: string;
  icon: string;
}

export const SETTINGS_SECTIONS: readonly SettingsSectionDefinition[] = [
  {
    id: "me",
    title: "Me",
    description: "Your profile and sign-in",
    icon: "👤",
  },
  {
    id: "family",
    title: "Family",
    description: "People, pets, and roles",
    icon: "👨‍👩‍👧‍👦",
  },
  {
    id: "safety",
    title: "Safety",
    description: "Emergency contacts and alerts",
    icon: "🛡️",
  },
  {
    id: "appearance",
    title: "Appearance",
    description: "Theme and home display",
    icon: "🎨",
  },
  {
    id: "home",
    title: "Home",
    description: "Layout and wall display",
    icon: "🏠",
  },
  {
    id: "system",
    title: "Connections & System",
    description: "Integrations, data, and updates",
    icon: "🔗",
  },
];

export const SETTINGS_SECTION_IDS: readonly SettingsSectionId[] = SETTINGS_SECTIONS.map(
  (section) => section.id,
);

const SAFE_NON_PARENT_SECTION_IDS: readonly SettingsSectionId[] = ["me", "safety", "appearance"];

export function settingsSectionsForRole(role: SettingsRole): SettingsSectionDefinition[] {
  return SETTINGS_SECTIONS.filter(
    (section) => role === "parent" || SAFE_NON_PARENT_SECTION_IDS.includes(section.id),
  );
}

export function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return typeof value === "string" && SETTINGS_SECTION_IDS.includes(value as SettingsSectionId);
}
