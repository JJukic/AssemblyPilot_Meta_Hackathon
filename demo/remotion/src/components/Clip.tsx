import { AbsoluteFill, Img, OffthreadVideo, getStaticFiles, interpolate, staticFile, useCurrentFrame } from "remotion";
import status from "../clip-status.json";
import { frames, FPS, type Shot } from "../manifest";
import { color, mono, sans } from "../theme";

const isAvailable = (src: string) =>
  !(status.unavailable as string[]).includes(src) && getStaticFiles().some((file) => file.name === src);

function MissingClip({ src }: { src: string }) {
  return (
    <AbsoluteFill style={{ background: color.bg, alignItems: "center", justifyContent: "center", gap: 16 }}>
      <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 44, color: color.text }}>Clip unavailable</div>
      <div style={{ fontFamily: mono, fontSize: 26, color: color.muted }}>{src}</div>
    </AbsoluteFill>
  );
}

/** Plays one manifest shot, with chrome crop, exposure lift and a slow push-in. */
export function Clip({ shot }: { shot: Shot }) {
  const frame = useCurrentFrame();
  const duration = frames(shot.dur);
  if (!isAvailable(shot.src)) return <MissingClip src={shot.src} />;
  const zoom = shot.zoom
    ? interpolate(frame, [0, duration], [shot.zoom.from, shot.zoom.to], { extrapolateRight: "clamp" })
    : 1;
  const origin = shot.zoom ? `${shot.zoom.x}% ${shot.zoom.y}%` : "50% 50%";
  const media = { width: "100%", height: "100%", objectFit: "cover" as const, objectPosition: shot.alignLeft ? "0% 0%" : "50% 0%" };
  // Footage from the Device Portal preview is dim; lift it without clipping the panel.
  const filter = `brightness(${shot.brightness ?? 1.38}) contrast(1.05) saturate(1.08)`;
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#000" }}>
      <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: origin }}>
        <AbsoluteFill style={{ transform: shot.chrome ? "scale(1.09)" : undefined, transformOrigin: "50% 0%", filter }}>
          {shot.src.endsWith(".jpg")
            ? <Img src={staticFile(shot.src)} style={media} />
            : <OffthreadVideo src={staticFile(shot.src)} muted trimBefore={Math.round(shot.from * FPS)} playbackRate={shot.rate ?? 1} style={media} />}
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
