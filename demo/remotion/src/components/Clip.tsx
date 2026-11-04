import { AbsoluteFill, Img, OffthreadVideo, getStaticFiles, interpolate, staticFile, useCurrentFrame } from "remotion";
import status from "../clip-status.json";
import { frames, FPS, type Shot } from "../manifest";
import { color, mono, sans } from "../theme";

const isAvailable = (src: string) =>
  !(status.unavailable as string[]).includes(src) && getStaticFiles().some((file) => file.name === src);

const FEATHER_SIDE = 0.1;
const FEATHER_BOTTOM = 0.03;
/** Matches the app background, so that a cut browser shot blends into the page. */
const APP_BACKGROUND = "#070d18";

function MissingClip({ src }: { src: string }) {
  return (
    <AbsoluteFill style={{ background: color.bg, alignItems: "center", justifyContent: "center", gap: 16 }}>
      <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 44, color: color.text }}>Clip unavailable</div>
      <div style={{ fontFamily: mono, fontSize: 26, color: color.muted }}>{src}</div>
    </AbsoluteFill>
  );
}

function Media({ shot }: { shot: Shot }) {
  const media = { width: "100%", height: "100%", objectFit: "cover" as const, objectPosition: "50% 0%" };
  return shot.src.endsWith(".jpg")
    ? <Img src={staticFile(shot.src)} style={media} />
    : <OffthreadVideo src={staticFile(shot.src)} muted trimBefore={Math.round(shot.from * FPS)} playbackRate={shot.rate ?? 1} style={media} />;
}

/**
 * Plays one manifest shot full frame. A shot with `place` moves the video so that its panel stays
 * clear of the chapter overlay; any uncovered edge shows the same shot, blurred, with a soft seam.
 */
export function Clip({ shot }: { shot: Shot }) {
  const frame = useCurrentFrame();
  const duration = frames(shot.dur);
  if (!isAvailable(shot.src)) return <MissingClip src={shot.src} />;
  // Footage from the Device Portal preview is dim; lift it without clipping the panel.
  const filter = `brightness(${shot.brightness ?? 1.38}) contrast(1.05) saturate(1.08)`;
  const inner = <AbsoluteFill style={{ transform: shot.chrome ? "scale(1.09)" : undefined, transformOrigin: "50% 0%", filter }}><Media shot={shot} /></AbsoluteFill>;

  if (shot.place) {
    const { scale, x, y, cut } = shot.place;
    const right = Math.min((x + scale) * 100, (cut ?? 2) * 100), bottom = (y + scale) * 100;
    const gapRight = right < 100, gapBottom = bottom < 100;
    const masks = [
      gapRight ? `linear-gradient(to right, #000 ${right - FEATHER_SIDE * 100}%, transparent ${right}%)` : "",
      gapBottom ? `linear-gradient(to bottom, #000 ${bottom - FEATHER_BOTTOM * 100}%, transparent ${bottom}%)` : "",
    ].filter(Boolean);
    const mask = masks.length ? { maskImage: masks.join(", "), WebkitMaskImage: masks.join(", "), maskComposite: "intersect" } : {};
    const push = interpolate(frame, [0, duration], [1, 1.012], { extrapolateRight: "clamp" });
    return (
      <AbsoluteFill style={{ overflow: "hidden", background: cut ? APP_BACKGROUND : "#000" }}>
        {masks.length > 0 && !cut && (
          <AbsoluteFill style={{ transform: "scale(1.16)", filter: "blur(38px)" }}>{inner}</AbsoluteFill>
        )}
        <AbsoluteFill style={mask}>
          <div style={{ position: "absolute", left: `${x * 100}%`, top: `${y * 100}%`, width: `${scale * 100}%`, height: `${scale * 100}%`, transform: `scale(${push})`, transformOrigin: "30% 40%" }}>
            {inner}
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  const zoom = shot.zoom ? interpolate(frame, [0, duration], [shot.zoom.from, shot.zoom.to], { extrapolateRight: "clamp" }) : 1;
  const origin = shot.zoom ? `${shot.zoom.x}% ${shot.zoom.y}%` : "50% 50%";
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#000" }}>
      <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: origin }}>{inner}</AbsoluteFill>
    </AbsoluteFill>
  );
}
