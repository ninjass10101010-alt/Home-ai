import SettingsSectionView from "@/components/settings/SettingsSectionView";
import FamilySettingsRoute from "@/components/settings/routes/FamilySettingsRoute";

export default function FamilySettingsPage() {
  return (
    <SettingsSectionView section="family">
      <FamilySettingsRoute />
    </SettingsSectionView>
  );
}
