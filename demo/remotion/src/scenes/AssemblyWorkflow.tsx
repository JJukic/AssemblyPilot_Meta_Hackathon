import { AbsoluteFill, Img, Series, interpolate, staticFile, useCurrentFrame } from "remotion";
import { frames, SHOT_INSPECTING, SHOT_READY, SHOT_VERIFIED, workflowShots } from "../manifest";
import { CaptureBadge, Caption, Grid, useEnter } from "../components/Overlays";
import { ShotSeries } from "../components/ShotSeries";
import { color, mono, sans } from "../theme";

type Crop = { src: string; x: [number, number]; y: [number, number] };

const PHOTO = { width: 3904, height: 2196 };
const TILE_HEIGHT = 350;

/** Shows a region of a real still photo at one uniform scale, so nothing is distorted. */
function CropImage({ crop }: { crop: Crop }) {
  const scale = TILE_HEIGHT / ((crop.y[1] - crop.y[0]) * PHOTO.height);
  const width = (crop.x[1] - crop.x[0]) * PHOTO.width * scale;
  return (
    <div style={{ width, height: TILE_HEIGHT, overflow: "hidden", position: "relative", background: "#000" }}>
      <Img src={staticFile(crop.src)} style={{ position: "absolute", width: PHOTO.width * scale, height: PHOTO.height * scale, left: -crop.x[0] * PHOTO.width * scale, top: -crop.y[0] * PHOTO.height * scale, maxWidth: "none", filter: "brightness(1.15)" }} />
    </div>
  );
}

function Tile({ title, tone, crop, delay }: { title: string; tone: string; crop: Crop; delay: number }) {
  const enter = useEnter(delay);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, opacity: enter, transform: `translateY(${interpolate(enter, [0, 1], [30, 0])}px)` }}>
      <div style={{ fontFamily: mono, fontWeight: 500, fontSize: 32, color: tone }}>{title}</div>
      <div style={{ border: `3px solid ${tone}`, borderRadius: 10, overflow: "hidden" }}><CropImage crop={crop} /></div>
    </div>
  );
}

function Arrow({ delay }: { delay: number }) {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [delay, delay + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <svg width="90" height="60" viewBox="0 0 110 60" style={{ marginTop: 40 }}>
      <line x1="6" y1="30" x2={6 + 86 * progress} y2="30" stroke={color.cyan} strokeWidth="5" strokeLinecap="round" />
      {progress > 0.95 && <path d="M84 16 L100 30 L84 44" fill="none" stroke={color.cyan} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

function Triptych() {
  return (
    <AbsoluteFill>
      <Grid />
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 170 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Tile title="Reference" tone={color.blue} delay={4} crop={{ src: SHOT_READY, x: [0.56, 0.74], y: [0.08, 0.41] }} />
          <Arrow delay={24} />
          <Tile title="Capture" tone={color.cyan} delay={32} crop={{ src: SHOT_INSPECTING, x: [0.262, 0.522], y: [0.238, 0.52] }} />
          <Arrow delay={52} />
          <Tile title="Result" tone={color.green} delay={60} crop={{ src: SHOT_VERIFIED, x: [0.268, 0.672], y: [0.2, 0.62] }} />
        </div>
      </AbsoluteFill>
      <CaptureBadge />
      <Caption step="4" text="Muse Spark compares capture and reference" />
    </AbsoluteFill>
  );
}

export function AssemblyWorkflow() {
  const before = workflowShots.before.reduce((t, s) => t + frames(s.dur), 0);
  const after = workflowShots.after.reduce((t, s) => t + frames(s.dur), 0);
  return (
    <Series>
      <Series.Sequence durationInFrames={before}><ShotSeries shots={workflowShots.before} /></Series.Sequence>
      <Series.Sequence durationInFrames={frames(5)}><Triptych /></Series.Sequence>
      <Series.Sequence durationInFrames={after}><ShotSeries shots={workflowShots.after} /></Series.Sequence>
    </Series>
  );
}
