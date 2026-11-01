"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useResource } from "@/hooks/useResource";
import { registry } from "@/lib/registry";
import { errorMessage } from "@/lib/api";
import { generatePlan, saveSetup, validPlan, type AssemblyPlan, type PlanStep, type SetupBlock, type SetupDescription } from "@/lib/setup";
import type { ProjectDetail } from "@/types/projects";
import { DraftPhoto, LibraryPhoto } from "./DraftPhoto";

const stages = ["Describe", "Your blocks", "Assembly steps", "Inspection mode", "Review & launch"];
const newBlock = (name = "", color = ""): SetupBlock => ({ key: crypto.randomUUID(), existing_id: null, name, color, quantity: 1, printed_text: "", logo_description: "", photo: null });
const stepFor = (blocks: SetupBlock[], instruction: string, index = 0): PlanStep => ({ title: `Step ${index + 1}`, instruction, parts: blocks.map((b) => ({ block_key: b.key, quantity: b.quantity })), print_check: null, reference_suggestion: "Take a clear photo of the correct arrangement for this step.", limitations: [] });
export function SetupWizard() {
  const library = useResource(registry.blocks);
  const [stage, setStage] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [blocks, setBlocks] = useState<SetupBlock[]>([]);
  const [photos, setPhotos] = useState<Record<string, File>>({});
  const [plan, setPlan] = useState<AssemblyPlan>({ steps: [] });
  const [source, setSource] = useState<"manual" | "meta" | "template">("manual");
  const [wantAI, setWantAI] = useState(false);
  const [mode, setMode] = useState<"simple" | "advanced">("simple");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState<ProjectDetail | null>(null);
  const request = useRef<AbortController | null>(null);
  const requestId = useRef<string | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  function changed() { setConfirmed(false); setError(""); }
  function photo(key: string, file?: File) { changed(); setPhotos((previous) => { const next = { ...previous }; if (file) next[key] = file; else delete next[key]; return next; }); }
  function removeBlock(key: string) {
    changed(); photo(key); setBlocks((rows) => rows.filter((b) => b.key !== key));
    setPlan((p) => ({ steps: p.steps.map((s) => ({ ...s, parts: s.parts.filter((part) => part.block_key !== key), print_check: s.print_check?.block_key === key ? null : s.print_check })) }));
  }
  function updateBlock(key: string, update: Partial<SetupBlock>) { changed(); setBlocks((rows) => rows.map((b) => b.key === key ? { ...b, ...update } : b)); }
  function updateStep(index: number, update: Partial<PlanStep>) { changed(); setPlan((p) => ({ steps: p.steps.map((s, i) => i === index ? { ...s, ...update } : s) })); }
  function moveStep(index: number, offset: number) {
    const target = index + offset; if (target < 0 || target >= plan.steps.length) return;
    changed(); const steps = [...plan.steps]; [steps[index], steps[target]] = [steps[target], steps[index]]; setPlan({ steps });
    setPhotos((current) => { const next = { ...current }; delete next[`step-${index}`]; delete next[`step-${target}`]; if (current[`step-${index}`]) next[`step-${target}`] = current[`step-${index}`]; if (current[`step-${target}`]) next[`step-${index}`] = current[`step-${target}`]; return next; });
  }
  function validBasics() { if (!name.trim() || !description.trim()) { setError("Give your project a name and describe what you want to assemble."); return false; } return true; }
  function validBlocks() { if (!blocks.length || blocks.some((b) => !b.name.trim() || !b.color.trim() || !Number.isInteger(b.quantity) || b.quantity < 1 || b.quantity > 1000)) { setError("Add at least one block with a name, color and whole-number quantity (1–1000)."); return false; } return true; }
  function manual() {
    if (!validBlocks()) return;
    if (!plan.steps.length) {
      const lines = instructions.split("\n").map((s) => s.trim()).filter(Boolean);
      if (lines.length > 20) { setError("Use at most 20 assembly steps."); return; }
      setPlan({ steps: (lines.length ? lines : [description]).map((line, i) => stepFor(blocks, line, i)) });
      if (source !== "template") setSource("manual");
    }
    setStage(2); setError("");
  }
  function payload(): SetupDescription { return { name, description, step_instructions: instructions, blocks: blocks.map((b) => ({ ...b, photo: photos[b.key] ? b.key : null })), finished_photo: photos.finished ? "finished" : null }; }
  async function generate() {
    if (!validBasics() || !validBlocks()) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError("");
    try {
      const input = payload();
      const used = Object.fromEntries(Object.entries(photos).filter(([key]) => key === "finished" || blocks.some((b) => b.key === key)));
      const draft = await generatePlan(input, used, controller.signal);
      if (!controller.signal.aborted) {
        if (!validPlan(draft.plan, blocks)) throw new Error("Meta returned no usable steps. Continue manually.");
        setPlan(draft.plan); setSource("meta"); setConfirmed(false); setStage(2); setNotice(`Draft proposed by ${draft.model}. Review every step before activating rules.`);
        setPhotos(used);
      }
    } catch (cause) { if (!controller.signal.aborted) setError(errorMessage(cause)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  function validateSteps() {
    if (!plan.steps.length || plan.steps.some((s) => !s.title.trim() || !s.instruction.trim() || !s.parts.length || s.parts.some((p) => !blocks.some((b) => b.key === p.block_key && p.quantity >= 1 && Number.isInteger(p.quantity) && p.quantity <= b.quantity)) || (s.print_check && (!s.print_check.expected_text.trim() || !s.parts.some((p) => p.block_key === s.print_check!.block_key && p.quantity === 1))))) {
      setError("Check each step's title, instructions and available quantities. A text check needs one assigned target and expected text."); return false;
    } return true;
  }
  async function save() {
    if (!confirmed || !validBasics() || !validBlocks() || !validateSteps()) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError("");
    requestId.current ??= crypto.randomUUID();
    try {
      const result = await saveSetup({ ...payload(), plan, source, mode, confirmed: true, request_id: requestId.current,
        step_photos: Object.fromEntries(plan.steps.flatMap((_, i) => photos[`step-${i}`] ? [[String(i), `step-${i}`]] : [])),
      }, photos, controller.signal);
      if (!controller.signal.aborted) setSaved(result);
    } catch (cause) { if (!controller.signal.aborted) setError(`${errorMessage(cause)} Your draft is retained. Retry unchanged to avoid duplicate projects.`); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  function template() {
    const blue = newBlock("Blue block", "blue"), yellow = newBlock("Yellow block", "yellow");
    setName("Two-block tower"); setDescription("Place the yellow block on top of the blue block."); setInstructions("Place the blue block on a flat surface.\nPlace the yellow block on top of the blue block.");
    setBlocks([blue, yellow]); setPlan({ steps: [stepFor([blue], "Place the blue block on a flat surface."), stepFor([blue, yellow], "Place the yellow block on top of the blue block.", 1)] });
    setPhotos({}); setSource("template"); setWantAI(false); changed(); setStage(1); setNotice("Demonstration template: replace the names and colors to match your real blocks. No measurements or reference photos are assumed.");
  }
  if (saved) return <section className="panel setup-wizard setup-success"><p className="eyebrow">READY TO BUILD</p><h2>{saved.name}</h2><p>{saved.steps.length} steps saved. Start your camera, capture your build, then choose Inspect with Meta AI.</p>
    <Link className="button primary" href={`/?project=${saved.id}`}>Start Inspection</Link>
    <Link className="button secondary" href={`/projects/${saved.id}`}>{mode === "advanced" ? "Configure advanced checks" : "Edit project and references"}</Link>
    <p className="muted">No inspection has run yet. You control every inspection and fresh-image verification.</p></section>;
  return <section className="panel setup-wizard" aria-label="Assembly setup wizard">
    <nav className="setup-progress" aria-label="Setup progress">{stages.map((label, i) => <span key={label} aria-current={i === stage ? "step" : undefined}>{i + 1}. {label}</span>)}</nav>
    <p className="muted">Nothing is saved until you confirm. Keep this page open to retain your draft.</p>
    {notice && <p role="status" className="success-note">{notice}</p>}
    <fieldset disabled={busy}>
    {stage === 0 && <><h2>What would you like to build?</h2><div className="setup-choices"><button className="button secondary" onClick={template}>Ready-made demonstration template</button><Link className="button secondary" href="/projects">Existing project</Link></div>
      <label className="field">Project name<input value={name} maxLength={160} onChange={(e) => { changed(); setName(e.target.value); }} placeholder="My first assembly" /></label>
      <label className="field">Assembly description<textarea value={description} maxLength={4000} rows={4} onChange={(e) => { changed(); setDescription(e.target.value); }} placeholder="Place the yellow block on top of the blue block. The yellow block must display Involve Me." /></label>
      <label className="field">Step-by-step instructions (optional)<textarea value={instructions} maxLength={8000} rows={3} onChange={(e) => { changed(); setInstructions(e.target.value); }} placeholder="One instruction per line, if you already have a plan." /></label>
      <DraftPhoto label="Finished assembly photo (optional)" file={photos.finished} onChange={(file) => photo("finished", file)} />
      <p>Next, choose or add your blocks. Meta can propose steps once it knows your inventory.</p>
      <div className="form-actions"><button className="button primary" onClick={() => { if (validBasics()) { setWantAI(true); setStage(1); setError(""); } }}>Generate Assembly Plan with Meta AI</button><button className="button secondary" onClick={() => { if (validBasics()) { setWantAI(false); setStage(1); setError(""); } }}>Set up manually</button></div>
    </>}
    {stage === 1 && <><h2>Register your building blocks</h2><p>Select library blocks or describe your own. No measurements are needed for Simple Mode.</p>
      {library.error && <p role="alert">{library.error} <button className="text-button" onClick={library.reload}>Reload library</button> You can still add custom blocks.</p>}
      {library.data?.length === 0 && <p>Your block library is empty. Add your first custom block below.</p>}
      {!library.data && !library.error && <p role="status">Loading block library…</p>}
      <div className="setup-library">{library.data?.map((b) => <label key={b.id}><input type="checkbox" checked={blocks.some((x) => x.existing_id === b.id)} onChange={(e) => { changed(); if (e.target.checked) setBlocks([...blocks, { ...newBlock(b.name, b.color), existing_id: b.id, quantity: b.default_quantity }]); else { const item = blocks.find((x) => x.existing_id === b.id)!; removeBlock(item.key); } }} /> {b.name} · {b.color}</label>)}</div>
      {blocks.map((b, i) => <section className="setup-block" key={b.key} aria-label={`Block ${i + 1}`}><h3>{b.existing_id ? "Library block" : "Custom block"} {i + 1}</h3><div className="form-grid">
        <label className="field">Block name<input value={b.name} disabled={!!b.existing_id} maxLength={160} onChange={(e) => updateBlock(b.key, { name: e.target.value })} /></label>
        <label className="field">Color<input value={b.color} disabled={!!b.existing_id} maxLength={80} onChange={(e) => updateBlock(b.key, { color: e.target.value })} /></label>
        <label className="field">Available quantity<input type="number" min={1} max={1000} value={b.quantity} onChange={(e) => updateBlock(b.key, { quantity: Number(e.target.value) })} /></label>
        <label className="field">Printed text (optional)<input value={b.printed_text} maxLength={500} onChange={(e) => updateBlock(b.key, { printed_text: e.target.value })} /></label>
        <label className="field">Logo description (optional)<input value={b.logo_description} maxLength={1000} onChange={(e) => updateBlock(b.key, { logo_description: e.target.value })} /></label>
      </div><p className="muted">Print and logo notes describe your block. Confirm a specific text rule in the next step. Precise logo matching needs a reference in Advanced Mode.</p>
        <LibraryPhoto image={library.data?.find((item) => item.id === b.existing_id)?.reference_images[0]} />
        <DraftPhoto label={`Block ${i + 1} reference photo`} file={photos[b.key]} onChange={(file) => photo(b.key, file)} />
        <button className="text-button" onClick={() => { removeBlock(b.key); }}>Remove block</button></section>)}
      <button className="button secondary" disabled={blocks.length >= 20} onClick={() => { changed(); setBlocks([...blocks, newBlock()]); }}>Add custom block</button>
      <p>Generation sends your description and selected photos to Meta. It creates an editable draft, not a verified construction.</p>
      <div className="form-actions"><button className={wantAI ? "button primary" : "button secondary"} onClick={() => void generate()}>Generate Assembly Plan with Meta AI</button><button className={wantAI ? "button secondary" : "button primary"} onClick={manual}>Continue manually</button></div>
    </>}
    {stage === 2 && <><h2>Review and edit your assembly steps</h2><p>These are instructions to inspect, not proof of correctness. Include earlier blocks when their appearance matters in a later step.</p>
      {plan.steps.map((s, i) => <section className="setup-step" key={i} aria-label={`Assembly step ${i + 1}`}><h3>Step {i + 1}</h3><div className="form-actions"><button className="button secondary" disabled={i === 0} onClick={() => moveStep(i, -1)}>Move step up</button><button className="button secondary" disabled={i === plan.steps.length - 1} onClick={() => moveStep(i, 1)}>Move step down</button></div>
        <label className="field">Step title<input value={s.title} maxLength={160} onChange={(e) => updateStep(i, { title: e.target.value })} /></label>
        <label className="field">Instruction<textarea rows={3} maxLength={4000} value={s.instruction} onChange={(e) => updateStep(i, { instruction: e.target.value })} /></label>
        <h4>Required blocks</h4>{blocks.map((b) => { const part = s.parts.find((p) => p.block_key === b.key); return <div className="setup-part" key={b.key}><label><input type="checkbox" checked={!!part} onChange={(e) => updateStep(i, { parts: e.target.checked ? [...s.parts, { block_key: b.key, quantity: 1 }] : s.parts.filter((p) => p.block_key !== b.key), print_check: s.print_check?.block_key === b.key ? null : s.print_check })} /> {b.name} ({b.color})</label><input aria-label={`Quantity of ${b.name} in step ${i + 1}`} type="number" min={1} max={b.quantity} disabled={!part} value={part?.quantity ?? 1} onChange={(e) => updateStep(i, { parts: s.parts.map((p) => p.block_key === b.key ? { ...p, quantity: Number(e.target.value) } : p) })} /></div>; })}
        <label className="field">Printed-text target<select value={s.print_check?.block_key ?? ""} onChange={(e) => updateStep(i, { print_check: e.target.value ? { block_key: e.target.value, expected_text: blocks.find((b) => b.key === e.target.value)?.printed_text ?? "" } : null })}><option value="">No text rule</option>{blocks.filter((b) => s.parts.some((p) => p.block_key === b.key)).map((b) => <option value={b.key} key={b.key}>{b.name}</option>)}</select></label>
        {s.print_check && <label className="field">Expected printed text<input maxLength={500} value={s.print_check.expected_text} onChange={(e) => updateStep(i, { print_check: { ...s.print_check!, expected_text: e.target.value } })} /><small>Checks readable words only. Does not certify physical facing direction.</small></label>}
        <label className="field">Suggested reference photograph<textarea value={s.reference_suggestion} maxLength={1000} onChange={(e) => updateStep(i, { reference_suggestion: e.target.value })} /></label>
        <DraftPhoto label={`Step ${i + 1} reference photo`} file={photos[`step-${i}`]} onChange={(file) => photo(`step-${i}`, file)} />
        {i === plan.steps.length - 1 && photos.finished && !photos[`step-${i}`] && <p>The finished assembly photo will be used for this final step only.</p>}
        <label className="field">Requirements not yet verifiable (one per line)<textarea value={s.limitations.join("\n")} maxLength={5000} onChange={(e) => updateStep(i, { limitations: e.target.value.split("\n").filter(Boolean) })} /></label>
        <button className="text-button" disabled={plan.steps.length === 1} onClick={() => { changed(); setPlan({ steps: plan.steps.filter((_, index) => index !== i) }); setPhotos((old) => { const next = { ...old }; for (let j = i; j < plan.steps.length; j++) { delete next[`step-${j}`]; if (old[`step-${j + 1}`]) next[`step-${j}`] = old[`step-${j + 1}`]; } return next; }); }}>Remove step</button>
      </section>)}
      <button className="button secondary" disabled={plan.steps.length >= 20} onClick={() => { changed(); setPlan({ steps: [...plan.steps, stepFor(blocks, "", plan.steps.length)] }); }}>Add assembly step</button>
      <button className="button primary" onClick={() => { if (validateSteps()) { setError(""); setStage(3); } }}>Choose inspection mode</button>
    </>}
    {stage === 3 && <><h2>Choose how to inspect</h2><div className="setup-mode-grid"><label className="setup-mode"><input type="radio" name="mode" checked={mode === "simple"} onChange={() => { changed(); setMode("simple"); }} /><strong>Simple Mode · recommended</strong><span>Semantic assembly inspection, requested/applicable SAM segmentation, configured text checks, correction guidance and fresh-image verification. No calibration needed.</span></label><label className="setup-mode"><input type="radio" name="mode" checked={mode === "advanced"} onChange={() => { changed(); setMode("advanced"); }} /><strong>Advanced Mode</strong><span>Use the existing precision editors after saving. No geometric rule is activated by selecting this mode.</span></label></div>
      {mode === "advanced" && <div className="setup-limitations"><h3>Precision setup available after confirmation</h3><ul><li>Project step editor: stud offsets, measured block heights and detailed tolerances.</li><li>Block Library: measured face dimensions, logo/contour references and physical printed-side orientation.</li><li>Camera workspace: ChArUco calibration and guided capture.</li><li>Inspected image: Canny edges, SAM outlines and supported Reference Match evidence.</li></ul><p>Enter actual measurements only when enabling the corresponding precision check. Missing calibration or matching evidence remains uncertain or not measured.</p></div>}
      <button className="button primary" onClick={() => setStage(4)}>Review project</button>
    </>}
    {stage === 4 && <><h2>Review before activation</h2><h3>{name}</h3><p>{description}</p><p><strong>{source === "meta" ? "AI-generated draft, with your edits" : source === "template" ? "Demonstration template, with your edits" : "Manual plan"}</strong> · {mode === "simple" ? "Simple Mode" : "Advanced tools available"}</p>
      <h3>Your blocks</h3><ul>{blocks.map((b) => <li key={b.key}>{b.quantity} × {b.name} · {b.color}{b.existing_id ? " · from library" : " · new custom block"}{b.printed_text && ` · Print note: ${b.printed_text}`}{b.logo_description && ` · Logo note: ${b.logo_description}`}<LibraryPhoto image={library.data?.find((item) => item.id === b.existing_id)?.reference_images[0]} /><DraftPhoto label={`${b.name} reference`} file={photos[b.key]} /></li>)}</ul>
      <h3>Ordered steps and active rules</h3><ol>{plan.steps.map((s, i) => <li className="setup-review-step" key={i}><h4>{s.title}</h4><p>{s.instruction}</p><p>{s.parts.map((p) => `${p.quantity} × ${blocks.find((b) => b.key === p.block_key)?.name ?? "Unknown block — return to edit"}`).join(", ")}</p><p>Semantic assembly inspection{s.print_check ? ` · Text must read “${s.print_check.expected_text}”` : " · No text rule"}</p><p>Suggested reference: {s.reference_suggestion || "None"}</p><DraftPhoto label={`Step ${i + 1} selected reference`} file={photos[`step-${i}`] ?? (i === plan.steps.length - 1 ? photos.finished : undefined)} />{!photos[`step-${i}`] && !(i === plan.steps.length - 1 && photos.finished) && <p>No step reference supplied; ambiguous arrangements may need another view.</p>}{s.limitations.length > 0 && <ul>{s.limitations.map((l, j) => <li key={j}>Not established: {l}</li>)}</ul>}</li>)}</ol>
      <aside className="setup-limitations"><h3>What this setup cannot verify yet</h3><p>Exact dimensions, stud offsets, physical facing direction and hidden connections are not measured by Simple Mode. Logo descriptions alone do not activate geometric logo matching. Raw Canny edges are not correctness evidence. Ambiguous visual evidence needs another view.</p><p>Correction guidance and fresh-image verification use the existing inspection workflow. SAM and Meta remain on demand; saving makes no inference call.</p></aside>
      <label className="setup-confirm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I reviewed the blocks, steps, reference photos and inspection rules and confirm their activation.</label>
      <button className="button primary" disabled={!confirmed} onClick={() => void save()}>Confirm and create project</button>
    </>}
    {stage > 0 && <button className="button secondary setup-back" onClick={() => { setStage(stage - 1); setError(""); }}>Back</button>}
    </fieldset>
    {busy && <p role="status">{stage === 4 ? "Saving your confirmed project…" : "Meta is drafting your assembly plan…"}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </section>;
}
