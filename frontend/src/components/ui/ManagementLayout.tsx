import Link from "next/link";
import { Boxes } from "lucide-react";
import { Navigation } from "./Navigation";

export function ManagementLayout({ active, title, description, children }: {
  active: "blocks" | "projects"; title: string; description: string; children: React.ReactNode;
}) {
  return <div className="app-shell">
    <header className="topbar">
      <Link href="/" className="brand"><div className="brand-icon"><Boxes size={24} /></div><div><span className="brand-name">Assembly<span>Pilot</span></span><p>Visual Assembly Intelligence</p></div></Link>
      <span className="tag">LOCAL REGISTRY</span>
    </header>
    <Navigation active={active} />
    <main className="management-main">
      <div className="page-heading"><div><p className="eyebrow">BUILD YOUR OWN COLLECTION</p><h1>{title}</h1><p className="muted">{description}</p></div></div>
      {children}
    </main>
    <footer><span>ASSEMBLYPILOT / YOUR WORKSPACE</span><span>Your blocks. Your projects. Stored locally.</span></footer>
  </div>;
}
