/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness transpiles TS modules. */
/* Local Whisper voice: WAV encoding, bounded loop, duplicates, cleanup, intent freshness. */
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
// api.ts reads process.env only; safe in Node.
const { encodeWav, downsample, rms, LocalVoiceController } = require("../src/lib/ar/voiceLocal.ts");
const { matchCommand } = require("../src/lib/ar/voice.ts");
const {
  saveVoiceVerifyIntent,
  readVoiceVerifyIntent,
  clearVoiceVerifyIntent,
  isFreshFrame,
} = require("../src/lib/ar/voiceVerify.ts");

test("WAV encoder emits a valid 16 kHz mono header and PCM payload", () => {
  const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1]), 16000);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(wav.length, 44 + 8);
  assert.equal(rms(new Float32Array([0, 0])), 0);
  assert.equal(downsample(new Float32Array(32000), 32000, 16000).length, 16000);
});

test("verify-again is an allowlisted command in English and German", () => {
  assert.equal(matchCommand("Verify again").action, "verify-again");
  assert.equal(matchCommand("Erneut prüfen").action, "verify-again");
  assert.equal(matchCommand("verify"), null);
});

function fakeController(transcripts, onCommand) {
  let clip = 0;
  const cleaned = [];
  const api = {
    createSession: async () => ({ token: "tok" }),
    revokeSession: async () => { cleaned.push("revoked"); },
    status: async () => ({ available: true, engine: "fake", model: "tiny", reason: "" }),
    transcribe: async () => {
      const t = transcripts[Math.min(clip - 1, transcripts.length - 1)];
      const m = matchCommand(t);
      return { matched: !!m, action: m?.action ?? null, phrase: m?.phrase ?? null, language: m?.language ?? null, transcript: t, duration_seconds: 1 };
    },
  };
  const controller = new LocalVoiceController({
    api,
    recordClip: async () => {
      clip++;
      return {
        samples: new Float32Array(16000).fill(0.5),
        sampleRate: 16000,
        stream: {},
        cleanup: () => cleaned.push(`clip${clip}`),
      };
    },
    onCommand,
  });
  return { controller, cleaned, clips: () => clip };
}

test("bounded loop dispatches next, suppresses duplicates, cleans up on stop", async () => {
  const got = [];
  const { controller, cleaned } = fakeController(["Next step", "Next step", "Exit AR"], async (c) => got.push(c.action));
  await controller.recordOnce();
  await controller.recordOnce(); // duplicate within cooldown: suppressed by gate
  assert.deepEqual(got, ["next"]);
  controller.stop();
  assert.ok(cleaned.includes("revoked"));
  assert.equal(controller.isListening, false);
});

test("microphone permission failure never loops and reports honestly", async () => {
  const errors = [];
  const controller = new LocalVoiceController({
    api: {
      createSession: async () => ({ token: "t" }),
      revokeSession: async () => {},
      status: async () => ({ available: true, engine: "fake", model: "tiny", reason: "" }),
      transcribe: async () => { throw new Error("should not be called"); },
    },
    recordClip: async () => { const e = new Error("denied"); e.name = "NotAllowedError"; throw e; },
    onCommand: () => {},
    onError: (m) => errors.push(m),
  });
  await controller.recordOnce();
  assert.ok(errors[0].includes("permission was denied"));
  controller.dispose();
});

test("voice verify intent is project/step scoped, fresh-only and expirable", () => {
  const store = new Map();
  global.window = { sessionStorage: {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  } };
  const now = Date.now();
  saveVoiceVerifyIntent({ mode: "verify", projectId: "p1", stepId: "s1", requestedAt: new Date(now).toISOString() });
  assert.equal(readVoiceVerifyIntent("p1", "s1", now)?.mode, "verify");
  assert.equal(readVoiceVerifyIntent("p2", "s1", now), null);
  assert.equal(readVoiceVerifyIntent("p1", "s2", now), null);
  assert.equal(readVoiceVerifyIntent("p1", "s1", now + 121000), null);
  assert.equal(isFreshFrame(new Date(now + 1000).toISOString(), new Date(now).toISOString()), true);
  assert.equal(isFreshFrame(new Date(now - 1000).toISOString(), new Date(now).toISOString()), false);
  clearVoiceVerifyIntent();
  assert.equal(readVoiceVerifyIntent("p1", "s1", now), null);
  delete global.window;
});
