import Link from "next/link";
import { ARWorkspace } from "@/components/ar/ARWorkspace";
import { ManagementLayout } from "@/components/ui/ManagementLayout";
export default async function ARPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project } = await searchParams;
  return (
    <ManagementLayout
      active="projects"
      title="Spatial assembly guidance"
      description="Intended placement on your tabletop. Holograms never prove correct assembly."
    >
      {project ? (
        <ARWorkspace key={project} projectId={project} />
      ) : (
        <>
          <p>Choose a project, then open Spatial AR guidance.</p>
          <Link href="/projects">Choose project</Link>
        </>
      )}
    </ManagementLayout>
  );
}
