"use client";
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/api";
import { localizeObjects, type ObjectLocalization } from "@/lib/object-localization";
import type { AnalyzedSnapshot } from "@/types/inspection";

export function ObjectLocalizationControls({ snapshot, ready, onResult }: {
  snapshot: AnalyzedSnapshot; ready: boolean; onResult: (result: ObjectLocalization | null) => void;
}) {
  const [concept, setConcept] = useState("building block");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  function reset() {
    request.current?.abort(); request.current = null;
    setBusy(false); setError(""); setMessage(""); onResult(null);
  }
  async function run(event: React.FormEvent) {
    event.preventDefault(); reset();
    const controller = new AbortController(); request.current = controller; setBusy(true);
    try {
      const result = await localizeObjects(snapshot, concept, controller.signal);
      if (!controller.signal.aborted) {
        onResult(result);
        setMessage(result.result.instances.length ? `${result.result.instances.length} visible object candidates · ${(result.latency_ms / 1000).toFixed(1)} s. Object numbers are not issue numbers.` : "SAM found no matching visible objects. Try a specific color or another view.");
      }
    } catch (cause) { if (!controller.signal.aborted) setError(errorMessage(cause)); }
    finally { if (!controller.signal.aborted) { request.current = null; setBusy(false); } }
  }
  return <form className="object-localization-controls" onSubmit={run}>
    <label className="field">Object to localize<input value={concept} maxLength={80} required placeholder="e.g. blue building block"
      onChange={(event) => { reset(); setConcept(event.target.value); }} /></label>
    <button className="button secondary" disabled={!ready || busy || !concept.trim()} type="submit">{busy ? "Segmenting objects…" : "Segment objects with SAM"}</button>
    <small>Sends this snapshot to Meta SAM once. Finds objects independently of the diagnosis; does not verify the assembly.</small>
    {busy && <p role="status">Waiting for SAM object masks…</p>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </form>;
}
