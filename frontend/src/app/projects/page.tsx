import { ProjectLibrary } from "@/components/projects/ProjectLibrary";
import { ManagementLayout } from "@/components/ui/ManagementLayout";

export default function ProjectsPage() {
  return <ManagementLayout active="projects" title="Built from your ideas." description="Turn your block library into ordered, repeatable assembly projects."><ProjectLibrary /></ManagementLayout>;
}
