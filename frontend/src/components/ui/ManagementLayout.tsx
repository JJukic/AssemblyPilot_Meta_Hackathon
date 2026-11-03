import { Brand } from "./Brand";
import { Navigation } from "./Navigation";

export function ManagementLayout({ active, title, description, children }: {
  active: "blocks" | "projects" | "settings"; title: string; description: string; children: React.ReactNode;
}) {
  return <div className="app-shell">
    <header className="topbar">
      <Brand href="/" />
      <span className="tag">{active === "settings" ? "WORKSPACE SETTINGS" : "LOCAL REGISTRY"}</span>
    </header>
    <Navigation active={active} />
    <main className="management-main">
      <div className="page-heading"><div><p className="eyebrow">{active === "settings" ? "CAMERA & DEBUGGING" : "BUILD YOUR OWN COLLECTION"}</p><h1>{title}</h1><p className="muted">{description}</p></div></div>
      {children}
    </main>
    <footer><span>ASSEMBLYPILOT / YOUR WORKSPACE</span><span>Your blocks. Your projects. Stored locally.</span></footer>
  </div>;
}
