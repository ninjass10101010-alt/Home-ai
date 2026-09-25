import SettingsSectionView from "@/components/settings/SettingsSectionView";
import SafetySettingsRoute from "@/components/settings/routes/SafetySettingsRoute";

export default function SafetySettingsPage() {
  return (
    <SettingsSectionView section="safety">
      <SafetySettingsRoute />
    </SettingsSectionView>
  );
}
