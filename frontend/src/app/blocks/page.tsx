import { BlockLibrary } from "@/components/blocks/BlockLibrary";
import { ManagementLayout } from "@/components/ui/ManagementLayout";

export default function BlocksPage() {
  return <ManagementLayout active="blocks" title="Your building blocks." description="A reusable library of the pieces you build with. Add dimensions, colors and real reference photos."><BlockLibrary /></ManagementLayout>;
}
