import SettingsSectionView from "@/components/settings/SettingsSectionView";
import AppearanceSettingsRoute from "@/components/settings/routes/AppearanceSettingsRoute";

export default function AppearanceSettingsPage() {
  return (
    <SettingsSectionView section="appearance">
      <AppearanceSettingsRoute />
    </SettingsSectionView>
  );
}
