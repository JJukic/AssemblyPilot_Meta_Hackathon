"use client";
import { useState } from "react";

export interface PrintConfig {
  expected_text: string; alternative_texts: string[]; logo_description: string;
  recognition_mode: "meta_auto" | "meta_references" | "contour" | "hybrid";
}
export function readPrintRule(fields: FormData): PrintConfig | null {
  if (!fields.has("print_enabled")) return null;
  return { expected_text: String(fields.get("expected_text") ?? ""),
    alternative_texts: String(fields.get("alternative_texts") ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
    logo_description: String(fields.get("logo_description") ?? ""),
    recognition_mode: fields.get("recognition_mode") as PrintConfig["recognition_mode"] };
}
export function PrintRuleFields({ value }: { value?: PrintConfig | null }) {
  const [enabled, setEnabled] = useState(!!value);
  const [mode, setMode] = useState<PrintConfig["recognition_mode"]>(value?.recognition_mode ?? "meta_auto");
  return <fieldset className="print-rule-fields"><legend>Automatic printed-side recognition</legend>
    <label><input type="checkbox" name="print_enabled" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Enable automatic print recognition</label>
    {enabled && <>
      <label className="field">Recognition mode<select name="recognition_mode" value={mode} onChange={(event) => setMode(event.target.value as PrintConfig["recognition_mode"])}>
        <option value="meta_auto">Meta Auto</option><option value="meta_references">Meta + References</option>
        <option value="contour">Contour Matching</option><option value="hybrid">Hybrid</option>
      </select></label>
      <label className="field">Expected printed text<input name="expected_text" defaultValue={value?.expected_text ?? ""} required={mode === "meta_auto"} maxLength={500} /></label>
      <label className="field">Known alternatives (one per line)<textarea name="alternative_texts" defaultValue={value?.alternative_texts.join("\n") ?? ""} rows={2} /></label>
      <label className="field">Optional logo description<textarea name="logo_description" defaultValue={value?.logo_description ?? ""} maxLength={1000} rows={2} /></label>
      <p className="muted">Meta Auto reads legible text without a reference photo. References are reusable across viewpoints. Reading text does not establish its physical facing direction.</p>
    </>}
  </fieldset>;
}
