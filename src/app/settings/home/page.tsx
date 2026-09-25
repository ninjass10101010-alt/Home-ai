import SettingsSectionView from "@/components/settings/SettingsSectionView";
import HomeSettingsRoute from "@/components/settings/routes/HomeSettingsRoute";

export default function HomeSettingsPage() {
  return (
    <SettingsSectionView section="home">
      <HomeSettingsRoute />
    </SettingsSectionView>
  );
}
