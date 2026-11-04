/**
 * Central clip configuration. Order, start point and duration of every shot live here.
 * Paths are relative to public/. Times are seconds within the source clip.
 * The audio generator, the footage check and the clip mapping all read this file.
 */
export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export type Sfx = "whoosh" | "tick" | "confirm" | "alert";

export type Shot = {
  id: string;
  src: string;
  /** Source start in seconds. Ignored for still images. */
  from: number;
  /** On-screen duration in seconds. */
  dur: number;
  /** Source playback speed. */
  rate?: number;
  /** Clip has a player bar at the bottom that must be cropped away. */
  chrome?: boolean;
  /** Slow push-in: scale range around an origin in percent of the frame. */
  zoom?: { from: number; to: number; x: number; y: number };
  brightness?: number;
  step?: string;
  caption?: string;
  /** Small honest note, such as a shortened wait. */
  note?: string;
  /** Source label. Defaults to the HoloLens label. */
  badge?: string;
  sfx?: Sfx;
};

const H = "footage/hololens";
export const BROWSER = "footage/browser/Bildschirmaufnahme 2026-11-04 um 21.49.08.mov";
export const INTRO = `${H}/intro.mov`;
export const STEP1 = `${H}/step1.mov`;
export const STEP2 = `${H}/step2.mp4`;
export const STEP3 = `${H}/step3.mp4`;
export const STEP4 = `${H}/step4.mp4`;
export const END = `${H}/End.mp4`;
export const SHOT_READY = `${H}/shot1.jpg`;
export const SHOT_HOLOGRAM = `${H}/shot2.jpg`;
export const SHOT_INSPECTING = `${H}/shot3.jpg`;
export const SHOT_VERIFIED = `${H}/shot4.jpg`;

export const introShots: Shot[] = [
  { id: "hook-mesh", src: INTRO, from: 19.7, dur: 1.5, chrome: true, sfx: "whoosh" },
  { id: "hook-panel", src: INTRO, from: 24.2, dur: 1.5, chrome: true },
  { id: "hook-field", src: INTRO, from: 41, dur: 1.6, chrome: true },
  { id: "hook-hands", src: STEP1, from: 12.6, dur: 1.5, chrome: true, sfx: "whoosh" },
  { id: "hook-red", src: STEP3, from: 1.2, dur: 1.5 },
  { id: "hook-camera", src: STEP2, from: 2.5, dur: 2, zoom: { from: 1.25, to: 1.4, x: 52, y: 28 } },
];

export const problemShot: Shot = { id: "problem-hands", src: INTRO, from: 54.2, dur: 12, rate: 0.5, chrome: true, brightness: 1.15 };

export const productShots: Shot[] = [
  { id: "product-home", src: INTRO, from: 3, dur: 2.5, chrome: true, zoom: { from: 1, to: 1.12, x: 62, y: 25 }, brightness: 1, sfx: "whoosh" },
  { id: "product-tabletop", src: INTRO, from: 24.3, dur: 2.5, chrome: true },
  { id: "product-field", src: INTRO, from: 40, dur: 2.5, chrome: true },
];

export const workflowShots: { before: Shot[]; after: Shot[] } = {
  before: [
    { id: "flow-target", src: SHOT_READY, from: 0, dur: 3, zoom: { from: 1.2, to: 1.45, x: 42, y: 25 }, step: "1", caption: "Target step and reference photo", sfx: "tick" },
    { id: "flow-brick", src: INTRO, from: 55.6, dur: 3, chrome: true, step: "2", caption: "The real brick in the field of view", brightness: 1.3 },
    { id: "flow-capture", src: SHOT_INSPECTING, from: 0, dur: 3, zoom: { from: 1.3, to: 1.5, x: 34, y: 40 }, step: "3", caption: "One exact frame is captured and sent to Meta", sfx: "tick" },
  ],
  after: [
    { id: "flow-next", src: STEP1, from: 6.2, dur: 3, chrome: true, zoom: { from: 1.15, to: 1.3, x: 42, y: 40 }, step: "5", caption: "The next assembly step appears", sfx: "tick" },
  ],
};

/** Zoomed so that the panels stay readable and the camera name in the dropdown stays out of frame. */
export const browserShots: Shot[] = [
  { id: "browser-live", src: BROWSER, from: 20.4, dur: 3.8, rate: 0.45, brightness: 1, badge: "Real browser capture", zoom: { from: 1.4, to: 1.46, x: 0, y: 0 }, caption: "The same workflow in a regular browser", sfx: "whoosh" },
  { id: "browser-parts", src: BROWSER, from: 62.5, dur: 4.2, brightness: 1, badge: "Real browser capture", zoom: { from: 1.65, to: 1.72, x: 0, y: 0 }, caption: "Your own parts, captured from a webcam" },
  { id: "browser-verified", src: BROWSER, from: 186, dur: 3.5, rate: 0.5, brightness: 1, badge: "Real browser capture", note: "Waits cut", zoom: { from: 1.5, to: 1.54, x: 0, y: 100 }, caption: "Verified on a fresh image", sfx: "tick" },
];

export const solveShots: Shot[] = [
  { id: "solve-place", src: STEP1, from: 12.6, dur: 2.5, chrome: true, caption: "Step 2: the blue brick goes on top", brightness: 1.3 },
  { id: "solve-inspect", src: STEP2, from: 0.5, dur: 1.5, zoom: { from: 1.3, to: 1.4, x: 40, y: 30 }, caption: "Meta inspects the captured frame", note: "Wait shortened" },
  { id: "solve-incorrect", src: STEP2, from: 8.5, dur: 4, zoom: { from: 1.35, to: 1.5, x: 58, y: 42 }, caption: "Incorrect: wrong printed side facing forward", sfx: "alert" },
  { id: "solve-plan", src: STEP2, from: 21, dur: 4.3, zoom: { from: 1.35, to: 1.5, x: 55, y: 45 }, caption: "Correction plan: rotate the blue block 180°" },
  { id: "solve-fix", src: STEP3, from: 7.5, dur: 2, caption: "The user corrects the real build", brightness: 1.3 },
  { id: "solve-again", src: STEP3, from: 13.8, dur: 2, zoom: { from: 1.15, to: 1.3, x: 55, y: 35 }, caption: "Only Check Again takes a new image", sfx: "tick" },
  { id: "solve-verify", src: STEP4, from: 1, dur: 5.5, zoom: { from: 1.3, to: 1.4, x: 42, y: 30 }, caption: "A new verification frame goes to Meta", note: "18.2 s wait shortened" },
  { id: "solve-verified", src: STEP4, from: 12.5, dur: 3.7, zoom: { from: 1.3, to: 1.45, x: 45, y: 38 }, caption: "Step verified: the workflow continues", sfx: "confirm" },
];

export const completionShots: Shot[] = [
  { id: "done-finish", src: END, from: 1.2, dur: 4, zoom: { from: 1.02, to: 1.1, x: 50, y: 18 }, caption: "Final step verified. Finish completes the assembly.", sfx: "confirm" },
  { id: "done-mascot", src: END, from: 11, dur: 5.5, caption: "From instructions to understanding.", sfx: "whoosh" },
  { id: "done-restart", src: END, from: 22.6, dur: 2.5, rate: 0.85, zoom: { from: 1.08, to: 1.14, x: 42, y: 40 }, caption: "Restart Assembly begins again at Step 1", sfx: "tick" },
];

const sum = (shots: Shot[]) => shots.reduce((total, shot) => total + shot.dur, 0);

/** Scene order and length in seconds. Footage scenes derive their length from their shots. */
export const scenes = [
  { id: "intro", dur: sum(introShots) },
  { id: "problem", dur: problemShot.dur },
  { id: "product", dur: 2.5 + sum(productShots) },
  { id: "workflow", dur: sum(workflowShots.before) + 5 + sum(workflowShots.after) },
  { id: "browser", dur: sum(browserShots) },
  { id: "solve", dur: sum(solveShots) },
  { id: "status", dur: 15.2 },
  { id: "ai", dur: 28.4 },
  { id: "completion", dur: sum(completionShots) },
  { id: "vision", dur: 19 },
  { id: "end", dur: 12.5 },
] as const;

export type SceneId = (typeof scenes)[number]["id"];

export const frames = (seconds: number) => Math.round(seconds * FPS);
export const totalFrames = scenes.reduce((total, scene) => total + frames(scene.dur), 0);
export const MAX_SECONDS = 180;

/**
 * Where each voice-over file plays. `at` is seconds into the scene; `from` and `to` cut a file
 * at a pause, so that a line can land on the shot it describes. Change the sync here.
 */
export type VoicePlacement = { voice: string; scene: SceneId; at: number; from?: number; to?: number };
export const voicePlacements: VoicePlacement[] = [
  { voice: "01-hook", scene: "intro", at: 0.3 },
  { voice: "02-problem", scene: "problem", at: 0.4 },
  { voice: "03-hololens", scene: "product", at: 0.2, to: 9.75 },
  { voice: "03-hololens", scene: "workflow", at: 3, from: 9.75 },
  { voice: "04-local-demo", scene: "browser", at: 0.5 },
  { voice: "05-problem-solving", scene: "solve", at: 1.5, to: 22.65 },
  { voice: "05-problem-solving", scene: "status", at: 0.3, from: 22.65 },
  { voice: "06-architecture", scene: "ai", at: 0.4 },
  { voice: "07-future-vision", scene: "vision", at: 0.4 },
  { voice: "08-closing", scene: "end", at: 0.4 },
];

/** Clips in the folder that are deliberately not used, or only partly used. */
export const exclusions = [
  { file: `${H}/intro.mov`, range: "0:00–0:02", reason: "Laptop on the table; a false start before the app is visible." },
  { file: `${H}/intro.mov`, range: "1:06–1:27", reason: "Device Portal capture page, with a private IP address and window chrome. Not product footage." },
  { file: `${H}/step3.mp4`, range: "0:20.6", reason: "H.264 decode error near this frame. Not used." },
  { file: `${H}/step4.mp4`, range: "0:21–0:30", reason: "Step 3 begins, but its verification is not in any clip. Also a decode error at 0:26.2." },
  { file: `${H}/End.mp4`, range: "0:25–0:26", reason: "Motion blur as the capture ends." },
  { file: SHOT_HOLOGRAM, range: "all", reason: "Good still, but the moving hologram clips tell the same thing better." },
];
