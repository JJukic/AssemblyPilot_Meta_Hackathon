import Link from "next/link";
import { Blocks, FolderOpen, ScanLine, Settings } from "lucide-react";

export function Navigation({ active }: { active: "workspace" | "blocks" | "projects" | "settings" }) {
  return <nav className="main-nav" aria-label="Main navigation">
    <Link href="/" aria-current={active === "workspace" ? "page" : undefined}><ScanLine size={16} /> Workspace</Link>
    <Link href="/blocks" aria-current={active === "blocks" ? "page" : undefined}><Blocks size={16} /> Block library</Link>
    <Link href="/projects" aria-current={active === "projects" ? "page" : undefined}><FolderOpen size={16} /> Projects</Link>
    <Link href="/settings" aria-current={active === "settings" ? "page" : undefined}><Settings size={16} /> Settings</Link>
  </nav>;
}
