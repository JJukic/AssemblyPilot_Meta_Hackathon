"use client";

import { ArrowUpRight, Boxes, CircleHelp, Eye, ScanLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Navigation } from "@/components/ui/Navigation";
import { EdgeDebugPanel } from "@/components/inspection/EdgeDebugPanel";
import { InspectionHistory } from "@/components/inspection/InspectionHistory";
import { CustomAssembly } from "@/components/assembly/CustomAssembly";
import { useResource } from "@/hooks/useResource";
import { registry } from "@/lib/registry";
import { AssemblyPanel } from "@/components/assembly/AssemblyPanel";
import { CalibrationPanel } from "@/components/calibration/CalibrationPanel";
import { CameraView } from "@/components/camera/CameraView";
import { StatusIndicator } from "@/components/ui/StatusIndicator";
import { useCamera } from "@/hooks/useCamera";
import { checkHealth } from "@/lib/api";
import { readVoiceVerifyIntent } from "@/lib/ar/voiceVerify";
import type { Assembly, ConnectionStatus } from "@/types/assembly";
import type { GeometrySetup } from "@/types/calibration";

export function Dashboard({ assembly, initialProjectId = "", initialStepId = "" }: { assembly: Assembly; initialProjectId?: string; initialStepId?: string }) {
  const projects = useResource(registry.projects);
  const [selectedProject, setSelectedProject] = useState(initialProjectId);
  const camera = useCamera();
  const cameraStart = camera.start;
  const autoCameraStarted = useRef("");
  useEffect(() => {
    if (!selectedProject || autoCameraStarted.current === selectedProject) return;
    if (readVoiceVerifyIntent(selectedProject)) {
      autoCameraStarted.current = selectedProject;
      void cameraStart();
    }
  }, [selectedProject, cameraStart]);
  const [backend, setBackend] = useState<ConnectionStatus>("checking");
  const [geometrySetup, setGeometrySetup] = useState<GeometrySetup | null>(null);
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
      <Navigation active="workspace" />
      <main>
        <div className="page-heading">
          <div><p className="eyebrow">YOUR ASSEMBLY WORKSPACE</p><h1>Build with a clearer view.</h1><p className="muted">Observe your build. Follow each step. Keep moving forward.</p></div>
          <div className="phase-badge"><span className="status-dot" /> PHASE 4 <span>Verification</span></div>
        </div>
        <section className="panel jury-start"><div><p className="eyebrow">YOUR FIRST BUILD</p><h2>Try AssemblyPilot with Your Own Blocks</h2><p>Bring your blocks. Describe your goal. Review a plan and start inspecting.</p></div><div className="form-actions"><Link className="button primary" href="/setup">Quick custom project</Link><Link className="button secondary" href="/setup">Demonstration template</Link><Link className="button secondary" href="/projects">Existing project</Link></div></section>
        <div className="project-selector panel">
          <label className="field"><span>Assembly project</span><select value={selectedProject} onChange={(event) => setSelectedProject(event.target.value)}>
            <option value="">Five-step practice demo</option>
            {selectedProject && !projects.data?.some((p) => p.id === selectedProject) && <option value={selectedProject}>Selected project</option>}
            {projects.data?.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select></label>
          <div>{projects.data?.length === 0 ? <p>No custom projects yet. <Link href="/projects">Create your first project</Link>.</p> : <Link href="/projects">Manage projects</Link>}
          {projects.error && <p className="muted">Custom projects unavailable. The practice demo and camera still work. <button className="text-button" onClick={projects.reload}>Retry</button></p>}</div>
        </div>
        {selectedProject && <Link className="button secondary" href={`/ar?project=${selectedProject}`}>Spatial AR guidance</Link>}
        <div className="workspace-grid"><CameraView camera={camera} />{selectedProject ? <CustomAssembly key={selectedProject} projectId={selectedProject} initialStepId={initialStepId} snapshot={camera.snapshot} captureFresh={() => camera.capture(false)} cameraReady={camera.status === "connected"} geometrySetup={geometrySetup} /> : <AssemblyPanel assembly={assembly} />}</div>
        <CalibrationPanel key={`${camera.deviceId}:${camera.status}`} camera={camera} onSelectionChange={setGeometrySetup} />
        <EdgeDebugPanel key={`${camera.deviceId}:${camera.snapshot?.capturedAt ?? "none"}`} snapshot={camera.snapshot} />
        <InspectionHistory />
        <section className="pipeline-panel" aria-label="AI inspection availability">
          <div className="pipeline-icon"><ScanLine size={22} /></div>
          <div className="pipeline-copy"><h2>Inspect your current assembly</h2><p>Select a custom project, capture a frame, then request a Meta AI diagnosis. Inspection runs only when you ask; step navigation stays manual.</p></div>
          <span className="tag"><Eye size={13} /> ON-DEMAND META AI</span>
        </section>
        <details className="camera-help">
          <summary><CircleHelp size={15} /> Camera setup tips <ArrowUpRight size={14} /></summary>
          <p>Use localhost or HTTPS and allow camera access in your browser. Select your webcam after permission is granted. An iPhone can be selected if Apple Continuity Camera exposes it as a camera; availability depends on your Apple devices and settings. If the camera disconnects, reconnect it and press Start camera. The camera works even when the backend is disconnected.</p>
        </details>
      </main>
      <footer><span>ASSEMBLYPILOT <span className="footer-divider">/</span> META AI DEVELOPER HACKATHON</span><span>Phase 4 · Correction and verification</span></footer>
    </div>
  );
}
