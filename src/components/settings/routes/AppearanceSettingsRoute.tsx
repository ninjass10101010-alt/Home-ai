"use client";

import dynamic from "next/dynamic";
import SettingsSectionLoading from "@/components/settings/routes/SettingsSectionLoading";

export default dynamic(() => import("@/components/settings/AppearanceSettingsSection"), { ssr: false, loading: SettingsSectionLoading });
