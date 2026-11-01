import { ManagementLayout } from "@/components/ui/ManagementLayout";
import { SetupWizard } from "@/components/setup/SetupWizard";
export default function SetupPage() {
  return <ManagementLayout active="projects" title="Try AssemblyPilot with Your Own Blocks" description="Describe your build, review a plan, and inspect with your camera. Start with a quick custom project or choose the demonstration template."><SetupWizard /></ManagementLayout>;
}
