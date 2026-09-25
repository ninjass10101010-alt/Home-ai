import SettingsSectionView from "@/components/settings/SettingsSectionView";
import MeSettingsRoute from "@/components/settings/routes/MeSettingsRoute";

export default function MeSettingsPage() {
  return (
    <SettingsSectionView section="me">
      <MeSettingsRoute />
    </SettingsSectionView>
  );
}
