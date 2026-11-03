import { WorkspaceSessionProvider } from "@/components/settings/WorkspaceSession";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceSessionProvider>{children}</WorkspaceSessionProvider>;
}
