import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { color, mono, sans } from "../theme";

/** Right text column: starts at 62 % of the width, 32 % wide, leaves 5 % or more on the right. */
export const COLUMN = { left: 1190, width: 614 };

export function useEnter(delay = 0) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 22 });
}

/** Number, line, title and short line. Shared by the chapter overlay and the static scenes. */
export function HeadingBlock({ number, title, subtitle, titleSize = 50, align }: { number?: string; title: string; subtitle?: string; titleSize?: number; align?: CSSProperties }) {
  return (
    <div style={align}>
      {number && <div style={{ fontFamily: mono, fontWeight: 500, fontSize: 30, lineHeight: 1.1, color: color.cyan }}>{number}</div>}
      {number && <div style={{ width: 64, height: 3, margin: "10px 0 14px", background: color.cyan, borderRadius: 2 }} />}
      <div style={{ fontFamily: sans, fontWeight: 800, fontSize: titleSize, lineHeight: 1.06, letterSpacing: -1, color: "#fff" }}>{title}</div>
      {subtitle && <div style={{ marginTop: 12, fontFamily: sans, fontWeight: 500, fontSize: 28, lineHeight: 1.25, color: color.muted }}>{subtitle}</div>}
    </div>
  );
}

/** Heading of a static scene, in the same right column as the video chapters. */
export function RightSectionHeading({ number, title, subtitle, delay = 6 }: { number?: string; title: string; subtitle?: string; delay?: number }) {
  const enter = useEnter(delay);
  return (
    <div style={{ position: "absolute", left: COLUMN.left, top: 162, width: COLUMN.width, opacity: enter }}>
      <HeadingBlock number={number} title={title} subtitle={subtitle} titleSize={62} />
    </div>
  );
}

/** The local text surface used by every plate over video. */
export const plate: CSSProperties = {
  background: "rgba(5,15,30,0.28)", border: "1px solid rgba(105,213,255,0.28)", borderRadius: 16,
  textShadow: "0 1px 10px rgba(0,0,0,0.65)", boxSizing: "border-box",
};

/** Short UI note on a small plate under the chapter overlay, clear of the footage's panels. */
export function Caption({ text, step, style }: { text: string; step?: string; style?: CSSProperties }) {
  const enter = useEnter(4);
  return (
    <div style={{
      ...plate, position: "absolute", left: COLUMN.left, top: 396, width: COLUMN.width, padding: "12px 22px", display: "flex", gap: 14, alignItems: "baseline",
      opacity: enter, ...style,
    }}>
      {step && <span style={{ fontFamily: mono, fontWeight: 500, fontSize: 24, color: color.cyan }}>{step}</span>}
      <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 27, color: color.text, lineHeight: 1.25 }}>{text}</span>
    </div>
  );
}

/** Small, quiet source label. Always bottom right, away from the chapter overlay. */
export function SourceBadge({ text }: { text: string }) {
  return (
    <div style={{
      position: "absolute", right: 96, bottom: 42, padding: "5px 11px", borderRadius: 6, background: "rgba(7,12,22,0.46)",
      fontFamily: mono, fontWeight: 500, fontSize: 19, color: "rgba(238,244,255,0.82)",
    }}>{text}</div>
  );
}

/** Marks footage as real capture, and states any shortened wait. */
export function CaptureBadge({ note, source = "Real HoloLens 2 capture" }: { note?: string; source?: string }) {
  return <SourceBadge text={note ? `${source} · ${note}` : source} />;
}

export function FadeScene({ duration, children }: { duration: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10, duration - 10, duration], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity, background: color.bg }}>{children}</AbsoluteFill>;
}

/** Faint tracking grid behind diagrams and other static scenes. */
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
