/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness transpiles TS modules. */
/* English-only interface: no German display strings; consistent control terminology. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename,
  );

const SRC = path.join(__dirname, "..", "src");
// Voice INPUT compatibility (German aliases) is separate from the display language.
const VOICE_INPUT = new Set(["lib/ar/voice.ts", "lib/ar/voice-commands.json"]);
const GERMAN = /[äöüÄÖÜß]|\b(Schritt|Prüfen|prüfen|Baustein|Bitte|Kamera|Fehler|Zurück|bestätigen|Anleitung|Montage|Weiter|Lege|Markierung|Deutsch)\b/;
// Mapping German colour names typed into block data to English adjectives is input handling.
const ALLOWED_LINE = /"grün": "green"|"weiß": "white"/;

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(path.join(dir, e.name)) : /\.(tsx?|json)$/.test(e.name) ? [path.join(dir, e.name)] : []);
}

test("no German display strings anywhere in the UI source (voice input aliases excepted)", () => {
  const hits = [];
  for (const file of files(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    if (VOICE_INPUT.has(rel)) continue;
    fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (GERMAN.test(line) && !ALLOWED_LINE.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(hits, []);
});

test("German voice aliases remain supported for input", () => {
  const { matchCommand, GERMAN_ALIASES } = require("../src/lib/ar/voice.ts");
  assert.ok(GERMAN_ALIASES.length > 0);
  assert.equal(matchCommand("Referenz anzeigen").action, "show-reference");
});

test("panel and guided controls use the agreed English terminology", () => {
  const { deriveGuide } = require("../src/lib/ar/guidedFlow.ts");
  const labels = (input) => deriveGuide({ anchored: true, checking: false, serverVerified: false, manuallyConfirmed: false, isLastStep: false, summary: null, ...input }).buttons.map((b) => b.label);
  assert.deepEqual(labels({}), ["Check Step"]);
  assert.deepEqual(labels({ summary: { kind: "inspection", overall: { kind: "uncertain" } } }), ["Check Again", "Confirm Position"]);
  assert.deepEqual(labels({ serverVerified: true }), ["Next Step ▶"]);
  const src = fs.readFileSync(path.join(SRC, "lib/ar/runtime.ts"), "utf8");
  for (const term of ["◀ Previous Step", "Show Result", "Show Instructions", "More Text ▶", "◀ Previous Text", "Start Autonomous", "Stop Autonomous", "⠿ Move Panel", "⟲ Rotate Panel", "Reset Panel Position", "Exit AR"])
    assert.ok(src.includes(term), term);
  const ws = fs.readFileSync(path.join(SRC, "components/ar/ARWorkspace.tsx"), "utf8");
  for (const term of ["Pause Autonomous", "Resume Autonomous", "Start Autonomous", "Next Step ▶", "◀ Previous Step"]) assert.ok(ws.includes(term), term);
});
