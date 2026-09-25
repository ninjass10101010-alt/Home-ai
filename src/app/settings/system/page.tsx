import SettingsSectionView from "@/components/settings/SettingsSectionView";
import SystemSettingsRoute from "@/components/settings/routes/SystemSettingsRoute";

export default function SystemSettingsPage() {
  return (
    <SettingsSectionView section="system">
      <SystemSettingsRoute />
    </SettingsSectionView>
  );
}
