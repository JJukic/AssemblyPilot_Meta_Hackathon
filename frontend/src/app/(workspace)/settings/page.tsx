import type { Metadata } from "next";
import { SettingsPage } from "@/components/settings/SettingsPage";

export const metadata: Metadata = { title: "Settings — AssemblyPilot" };

export default function Settings() {
  return <SettingsPage />;
}
