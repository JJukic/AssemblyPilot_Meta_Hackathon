import { ProjectWorkspace } from "@/components/projects/ProjectWorkspace";
import { ManagementLayout } from "@/components/ui/ManagementLayout";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ManagementLayout active="projects" title="Shape the next step." description="Write clear instructions, assign your blocks and keep every step in order."><ProjectWorkspace projectId={projectId} /></ManagementLayout>;
}
