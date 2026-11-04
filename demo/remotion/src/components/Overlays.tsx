import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { color, mono, sans } from "../theme";

export function useEnter(delay = 0) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 22 });
}

/** Lower-third caption on a solid plate, so that it survives video compression. */
export function Caption({ text, step }: { text: string; step?: string }) {
  const enter = useEnter(4);
  return (
    <div style={{
      position: "absolute", left: 72, bottom: 180, display: "flex", alignItems: "center", gap: 24, maxWidth: 1500,
      padding: "20px 34px", background: "rgba(7,12,22,0.88)", borderLeft: `6px solid ${color.cyan}`, borderRadius: 8,
      opacity: enter, transform: `translateX(${interpolate(enter, [0, 1], [-34, 0])}px)`,
    }}>
      {step && <span style={{ fontFamily: mono, fontWeight: 500, fontSize: 34, color: color.cyan }}>{step}</span>}
      <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 36, color: color.text, lineHeight: 1.2 }}>{text}</span>
    </div>
  );
}

export function Label({ text, style }: { text: string; style?: CSSProperties }) {
  return (
    <div style={{
      position: "absolute", padding: "9px 16px", borderRadius: 6, background: "rgba(7,12,22,0.82)",
      fontFamily: mono, fontWeight: 500, fontSize: 24, color: color.muted, ...style,
    }}>{text}</div>
  );
}

/** Marks footage as real capture, and states any shortened wait. */
export function CaptureBadge({ note, source = "Real HoloLens 2 capture" }: { note?: string; source?: string }) {
  return <Label text={note ? `${source} · ${note}` : source} style={{ top: 40, right: 48 }} />;
}

export function FadeScene({ duration, children }: { duration: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10, duration - 10, duration], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity, background: color.bg }}>{children}</AbsoluteFill>;
}

/** Faint tracking grid for the diagram scenes only. */
export function Grid() {
  return (
    <AbsoluteFill style={{
      background: `radial-gradient(1200px 700px at 50% 42%, rgba(72,140,255,0.18), transparent 70%), ${color.bg}`,
    }}>
      <AbsoluteFill style={{
        opacity: 0.5,
        backgroundImage: "linear-gradient(rgba(63,208,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(63,208,255,0.07) 1px, transparent 1px)",
        backgroundSize: "72px 72px",
      }} />
    </AbsoluteFill>
  );
}

export function Headline({ text, size = 76, delay = 0, tone = color.text, style }: { text: string; size?: number; delay?: number; tone?: string; style?: CSSProperties }) {
  const enter = useEnter(delay);
  return (
    <div style={{
      fontFamily: sans, fontWeight: 800, fontSize: size, lineHeight: 1.14, letterSpacing: -1, color: tone, textAlign: "center",
      opacity: enter, transform: `translateY(${interpolate(enter, [0, 1], [26, 0])}px)`, ...style,
    }}>{text}</div>
  );
}
