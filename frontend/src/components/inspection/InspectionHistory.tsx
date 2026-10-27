"use client";
import { useState } from "react";
import { DiagnosisDetails } from "./DiagnosisDetails";
import { useInspectionSession } from "./InspectionSession";

export function InspectionHistory() {
  const { entries, clear } = useInspectionSession();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = entries.find((entry) => entry.id === selectedId);
  return <section className="panel inspection-history" aria-label="Inspection history">
    <div className="panel-heading"><h2>Inspection history</h2><button className="button secondary" disabled={!entries.length} onClick={() => { clear(); setSelectedId(null); }}>Clear history</button></div>
    <div className="inspection-content">
      <p className="muted">Last 10 completed inspections in this tab. Refreshing or closing the tab clears history. Recorded images are separate from the current camera view.</p>
      {!entries.length && <p>No inspections in this session yet.</p>}
      <ul className="history-list">{entries.map((entry) => <li key={entry.id}>
        <button className="history-entry" aria-pressed={selectedId === entry.id} onClick={() => setSelectedId(selectedId === entry.id ? null : entry.id)}>
          <strong>{entry.project_name} · {entry.step_title}</strong>
          <span>{entry.result.status} · {(entry.result.model_latency_ms / 1000).toFixed(2)} s · <time dateTime={entry.result.inspected_at}>{new Date(entry.result.inspected_at).toLocaleString()}</time></span>
        </button>
      </li>)}</ul>
      {selected && <section className="history-detail" aria-label="Recorded inspection">
        <h3>Recorded inspection · {selected.step_title}</h3>
        <p className="muted">Captured <time dateTime={selected.captured_at}>{new Date(selected.captured_at).toLocaleString()}</time>. This is a historical snapshot.</p>
        <DiagnosisDetails result={selected.result} />
      </section>}
    </div>
  </section>;
}
