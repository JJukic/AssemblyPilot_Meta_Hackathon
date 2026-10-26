"use client";

import { ArrowUpRight, Boxes, CircleHelp, Eye, ScanLine } from "lucide-react";
import { useEffect, useState } from "react";
import { AssemblyPanel } from "@/components/assembly/AssemblyPanel";
import { CameraView } from "@/components/camera/CameraView";
import { StatusIndicator } from "@/components/ui/StatusIndicator";
import { useCamera } from "@/hooks/useCamera";
import { checkHealth } from "@/lib/api";
import type { Assembly, ConnectionStatus } from "@/types/assembly";

export function Dashboard({ assembly }: { assembly: Assembly }) {
  const camera = useCamera();
  const [backend, setBackend] = useState<ConnectionStatus>("checking");
  useEffect(() => {
    const controller = new AbortController();
    const check = async () => {
      try {
        await checkHealth(controller.signal);
        if (!controller.signal.aborted) setBackend("connected");
      } catch {
        if (!controller.signal.aborted) setBackend("disconnected");
      }
    };
    void check();
    const interval = setInterval(() => void check(), 10000);
    return () => { controller.abort(); clearInterval(interval); };
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-icon"><Boxes size={24} /></div><div><span className="brand-name">Assembly<span>Pilot</span></span><p>Visual Assembly Intelligence</p></div></div>
        <div className="header-status"><StatusIndicator label="Backend" status={backend} /><StatusIndicator label="Camera" status={camera.status} /></div>
      </header>
      <main>
        <div className="page-heading">
          <div><p className="eyebrow">YOUR ASSEMBLY WORKSPACE</p><h1>Build with a clearer view.</h1><p className="muted">Observe your build. Follow each step. Keep moving forward.</p></div>
          <div className="phase-badge"><span className="status-dot" /> PHASE 01 <span>Foundation</span></div>
        </div>
        <div className="workspace-grid"><CameraView camera={camera} /><AssemblyPanel assembly={assembly} /></div>
        <section className="pipeline-panel" aria-label="AI inspection availability">
          <div className="pipeline-icon"><ScanLine size={22} /></div>
          <div className="pipeline-copy"><h2>A foundation for visual intelligence</h2><p>Camera capture and manual guidance are ready. Meta-powered diagnosis, correction and verification are coming in a later phase.</p></div>
          <span className="tag"><Eye size={13} /> INFERENCE NOT IMPLEMENTED</span>
        </section>
        <details className="camera-help">
          <summary><CircleHelp size={15} /> Camera setup tips <ArrowUpRight size={14} /></summary>
          <p>Use localhost or HTTPS and allow camera access in your browser. Select your webcam after permission is granted. An iPhone can be selected if Apple Continuity Camera exposes it as a camera; availability depends on your Apple devices and settings. If the camera disconnects, reconnect it and press Start camera. The camera works even when the backend is disconnected.</p>
        </details>
      </main>
      <footer><span>ASSEMBLYPILOT <span className="footer-divider">/</span> META AI DEVELOPER HACKATHON</span><span>Phase 1 · Local workspace</span></footer>
    </div>
  );
}
