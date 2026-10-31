"use client";
import { useCallback, useState } from "react";
import { useResource } from "@/hooks/useResource";
import { apiRequest, errorMessage } from "@/lib/api";
import { PrintRuleFields, readPrintRule, type PrintConfig } from "./PrintRuleFields";
import { ImageManager } from "@/components/ui/ImageManager";
import type { ReferenceImage } from "@/types/blocks";

export interface Face { print_rule?: PrintConfig | null; id: string; block_id: string; label: string; name: string; description: string; width_mm: number; height_mm: number; references: ReferenceImage[] }
export function FaceEditor({ blockId }: { blockId: string }) {
  const endpoint = `/api/blocks/${blockId}/faces`;
  const load = useCallback(() => apiRequest<Face[]>(endpoint), [endpoint]);
  const { data, error, reload } = useResource(load);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [createVersion, setCreateVersion] = useState(0);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form);
    setBusy(true); setFailure("");
    try {
      await apiRequest(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: fields.get("label"), name: fields.get("name"), description: fields.get("description"), print_rule: readPrintRule(fields), width_mm: Number(fields.get("width")), height_mm: Number(fields.get("height")) }) });
      form.reset(); setCreateVersion((value) => value + 1); reload();
    } catch (cause) { setFailure(errorMessage(cause)); } finally { setBusy(false); }
  }
  return <section className="image-manager" aria-label="Printed faces"><h3>Printed faces</h3>
    <p className="muted">Define physical labels only for distinguishable faces. Front is local −Y, back +Y; left −X, right +X; top +Z. Photos are optional for Meta Auto text recognition. For contour matching, use upright photos cropped to one complete flat face. Physical dimensions support orientation; they are not recognition evidence.</p>
    {(failure || error) && <p role="alert">{failure || error}</p>}
    {!data && !error && <p role="status">Loading registered faces…</p>}
    {data?.map((face) => <details key={face.id}><summary>{face.name} · {face.label}</summary><p>{face.description}</p>
      <form onSubmit={async (event) => { event.preventDefault(); const fields = new FormData(event.currentTarget); try { await apiRequest(`${endpoint}/${face.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: face.label, name: fields.get("name"), description: fields.get("description"), print_rule: readPrintRule(fields), width_mm: face.width_mm, height_mm: face.height_mm }) }); reload(); } catch (cause) { setFailure(errorMessage(cause)); } }}>
        <label className="field">Registered face name<input name="name" defaultValue={face.name} required maxLength={160} /></label>
        <label className="field">Registered print description<input name="description" defaultValue={face.description} maxLength={1000} /></label>
        <PrintRuleFields value={face.print_rule} />
        <button className="button secondary" type="submit">Save face description</button>
      </form>
      <ImageManager images={face.references} endpoint={`${endpoint}/${face.id}/images`} onChange={reload} />
      <button type="button" className="text-button" onClick={async () => { if (!confirm("Delete this face definition? Its photos remain block references.")) return; try { await apiRequest(`${endpoint}/${face.id}`, { method: "DELETE" }); reload(); } catch (cause) { setFailure(errorMessage(cause)); } }}>Delete face</button>
    </details>)}
    <form onSubmit={save}><fieldset disabled={busy}>
      <label className="field">Physical face<select name="label"><option>front</option><option>back</option><option>left</option><option>right</option><option>top</option><option>bottom</option></select></label>
      <label className="field">Face name<input name="name" required maxLength={160} /></label>
      <label className="field">Printed text or logo description<input name="description" maxLength={1000} /></label>
      <label className="field">Face width (mm)<input name="width" type="number" min="0.1" max="500" step="any" required /></label>
      <label className="field">Face height (mm)<input name="height" type="number" min="0.1" max="500" step="any" required /></label>
      <PrintRuleFields key={createVersion} />
      <button className="button secondary" type="submit">Register face</button>
    </fieldset></form>
  </section>;
}
