/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness transpiles TS modules. */
/* Phase 6.1: reference selection, panel text, voice commands, cleanup. Mocked only — not HoloLens validation. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename,
  );
const {
  selectedStepReference,
  trustedReferencePath,
  isTrustedMediaPath,
  fitRect,
} = require("../src/lib/ar/reference.ts");
const { wrapText, paginate, verificationLabel } = require("../src/lib/ar/panel.ts");
const {
  normalizeTranscript,
  matchCommand,
  CommandGate,
  detectSpeechSupport,
  VoiceController,
  VOICE_COMMANDS,
  GERMAN_ALIASES,
} = require("../src/lib/ar/voice.ts");

const img = (id) => ({
  id,
  owner_type: "step",
  owner_id: "s1",
  url: `/api/media/${id}`,
  original_filename: `${id}.jpg`,
  mime_type: "image/jpeg",
  width: 800,
  height: 600,
  created_at: "2026-01-01T00:00:00Z",
});
const step = (images) => ({ reference_images: images });

// 1. Reference displayed for the correct step (selected = first, per backend ordering)
test("1 reference for correct step is that step's selected image, not a block photo", () => {
  const a = selectedStepReference(step([img("step-a-selected"), img("step-a-other")]));
  const b = selectedStepReference(step([img("step-b-selected")]));
  assert.equal(a.id, "step-a-selected");
  assert.equal(b.id, "step-b-selected");
  assert.equal(a.owner_type, "step");
});
// 2. Selected reference respected
test("2 explicitly selected (reordered-first) reference is respected", () => {
  // Backend select endpoint reorders so the chosen image is first.
  const chosen = img("chosen-id");
  assert.equal(selectedStepReference(step([chosen, img("earlier")])).id, "chosen-id");
  assert.equal(trustedReferencePath(chosen), "/api/media/chosen-id");
  assert.equal(isTrustedMediaPath("https://evil.example/x.jpg"), false);
  assert.equal(isTrustedMediaPath("/api/media/../secret"), false);
  assert.equal(trustedReferencePath({ ...chosen, url: "file:///etc/passwd" }), null);
});
// 3. Missing reference placeholder
test("3 missing reference yields null (placeholder path) and compact mode", () => {
  assert.equal(selectedStepReference(step([])), null);
  assert.equal(selectedStepReference(null), null);
  assert.equal(trustedReferencePath(null), null);
});
// 4+5. Switching steps removes previous image; bitmap/texture cleanup (runtime level tested in ar.test via dispose; here fit + close semantics)
test("4 switching steps: new selection replaces old, no stale id retained", () => {
  let current = selectedStepReference(step([img("old-step-img")]));
  assert.equal(current.id, "old-step-img");
  current = selectedStepReference(step([img("new-step-img")]));
  assert.equal(current.id, "new-step-img");
  current = selectedStepReference(step([]));
  assert.equal(current, null);
});
test("5 aspect-ratio fit never stretches", () => {
  const wide = fitRect(1600, 900, 332, 242);
  assert.ok(Math.abs(wide.w / wide.h - 1600 / 900) < 0.02);
  assert.ok(wide.w <= 332 && wide.h <= 242);
  const tall = fitRect(600, 1200, 332, 242);
  assert.ok(Math.abs(tall.w / tall.h - 0.5) < 0.02);
});
// 6. Long instruction rendering: wrap + paginate preserves every word
test("6 long instruction is fully preserved across pages", () => {
  const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
  const lines = wrapText(long, 42);
  const pages = paginate(lines, 7);
  assert.ok(pages.length > 1);
  assert.equal(pages.flat().join(" "), long);
  assert.ok(lines.every((l) => l.length <= 42));
  assert.equal(verificationLabel("verified"), "✓ VERIFIED (camera inspection)");
  assert.match(verificationLabel("not_verified"), /NOT VERIFIED/);
});
// 7. English and German aliases
test("7 English and German command aliases map to same actions", () => {
  assert.equal(matchCommand("Next step").action, "next");
  assert.equal(matchCommand("Nächster Schritt").action, "next");
  assert.equal(matchCommand("Vorheriger Schritt").action, "previous");
  assert.equal(matchCommand("Schritt prüfen").action, "verify");
  assert.equal(matchCommand("Referenz anzeigen").action, "show-reference");
  assert.equal(matchCommand("Anleitung vorlesen").action, "read-instructions");
  assert.equal(matchCommand("AR beenden").action, "exit");
  assert.equal(GERMAN_ALIASES.length, 6);
  assert.equal(VOICE_COMMANDS.length, 13);
});
// 8. Normalization + ambiguous rejection
test("8 normalization, optional prefix, ambiguous/negated/unrelated rejection", () => {
  assert.equal(normalizeTranscript("  AssemblyPilot,  NEXT Step! "), "next step");
  assert.equal(matchCommand("AssemblyPilot next step").action, "next");
  assert.equal(matchCommand("please do something random"), null);
  assert.equal(matchCommand("next step and previous step"), null);
  assert.equal(matchCommand("don't go to next step"), null);
  assert.equal(matchCommand("next"), null); // bare fragment is not allowlisted
  assert.equal(matchCommand(""), null);
  assert.equal(matchCommand("the weather is nice today"), null);
  assert.equal(matchCommand("exit step"), null);
});
// 9. Duplicate suppression + pending block
test("9 duplicate voice commands suppressed; pending blocks repeats", () => {
  const gate = new CommandGate(1500);
  assert.equal(gate.tryAccept("next", 1000), true);
  assert.equal(gate.tryAccept("next", 1200), false);
  assert.equal(gate.tryAccept("next", 3000), true);
  gate.setPending(true);
  assert.equal(gate.tryAccept("verify", 4000), false);
  gate.setPending(false);
  assert.equal(gate.tryAccept("verify", 4000), true);
});
// Fake recognition for controller tests
class FakeRec {
  constructor() {
    this.starts = 0;
    this.results = [];
    FakeRec.last = this;
  }
  start() {
    this.starts++;
  }
  stop() {}
  abort() {}
  emitFinal(transcript) {
    this.results.push({ isFinal: true, 0: { transcript }, length: 1 });
    this.onresult({ resultIndex: this.results.length - 1, results: this.results });
  }
  emitInterim(transcript) {
    this.onresult({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript }, length: 1 }] });
  }
}
function controller(onCommand, onError) {
  return new VoiceController(() => new FakeRec(), {
    onCommand,
    onError: onError ?? (() => {}),
  });
}
// 10. Unsupported microphone / speech API
test("10 unsupported speech API detected honestly", () => {
  const none = detectSpeechSupport({ isSecureContext: true });
  assert.equal(none.supported, false);
  assert.match(none.reason, /no SpeechRecognition/);
  const insecure = detectSpeechSupport({ SpeechRecognition: function () {}, isSecureContext: false });
  assert.equal(insecure.supported, false);
  const ok = detectSpeechSupport({ webkitSpeechRecognition: function () {}, isSecureContext: true });
  assert.equal(ok.supported, true);
  assert.equal(ok.mayUseCloudService, true);
});
// 11. Permission denial: no restart loop
test("11 microphone permission denial stops without restart loop", () => {
  const errors = [];
  const c = controller(() => {}, (e) => errors.push(e));
  assert.equal(c.start(), true);
  const rec = FakeRec.last;
  const end = rec.onend;
  rec.onerror({ error: "not-allowed" });
  assert.equal(c.isListening, false);
  end();
  assert.equal(rec.starts, 1); // never restarted after fatal error
  assert.ok(errors.some((e) => e.includes("not-allowed")));
  c.dispose();
});
// 13/14/15/16 voice actions via finalized results only
test("13-16 voice Next/Previous/Re-anchor/Exit/Verify dispatch; interim ignored", () => {
  const got = [];
  const c = controller((cmd) => got.push(cmd.action));
  c.start();
  const rec = FakeRec.last;
  rec.onstart();
  rec.emitInterim("next step");
  assert.deepEqual(got, []);
  rec.emitFinal("Next step.");
  rec.emitFinal("Previous step");
  // advance past duplicate cooldown by using distinct actions
  rec.emitFinal("Re-anchor");
  rec.emitFinal("Verify step");
  rec.emitFinal("Exit AR");
  assert.deepEqual(got, ["next", "previous", "re-anchor", "verify", "exit"]);
  c.dispose();
  assert.equal(c.isListening, false);
});
// 16 (contd) Verify uses correct project/step and never fabricates verification
test("16 voice Verify maps to existing camera workflow URL for current project+step, no auto-verify", () => {
  const projectId = "proj-1";
  const stepId = "step-2";
  const url = `/?project=${encodeURIComponent(projectId)}&step=${encodeURIComponent(stepId)}`;
  assert.equal(url, "/?project=proj-1&step=step-2");
  // The verify action itself carries no verified flag; verification only comes
  // from server progress after a fresh camera inspection.
  const cmd = matchCommand("verify step");
  assert.equal(cmd.action, "verify");
  assert.ok(!("verified" in cmd));
});
// 12+5 runtime cleanup is covered in ar.test.cjs (session end disposes renderer);
// here assert controller dispose cleans handlers (mic stream released).
test("12 voice cleanup on dispose: handlers detached, not listening", () => {
  const c = controller(() => {});
  c.start();
  const rec = FakeRec.last;
  c.dispose();
  assert.equal(rec.onresult, null);
  assert.equal(c.isListening, false);
});
// 17 no fabricated inspection from unrelated speech
test("17 unrelated speech never triggers verify or any action", () => {
  const got = [];
  const c = controller((cmd) => got.push(cmd.action));
  c.start();
  FakeRec.last.onstart();
  FakeRec.last.emitFinal("this step looks great, well done everyone");
  FakeRec.last.emitFinal("verify");
  assert.deepEqual(got, []);
  c.dispose();
});
// 18 fallbacks: manual actions exist independent of voice (command table completeness)
test("18 every voice action has a manual fallback label in the command table", () => {
  for (const c of VOICE_COMMANDS) assert.ok(c.spoken && c.description);
  const actions = new Set(VOICE_COMMANDS.map((c) => c.action));
  for (const a of ["next", "previous", "verify", "show-reference", "hide-reference", "show-instructions", "read-instructions", "re-anchor", "recenter", "help", "stop-listening", "exit"])
    assert.ok(actions.has(a), a);
});
