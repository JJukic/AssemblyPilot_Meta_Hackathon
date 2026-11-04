import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { color, mono, sans } from "../theme";

/** Footage card on the left, so that the right column never covers a panel or hologram. */
export const CARD = { left: 56, top: 64, width: 1110, height: 770 };
/** Right text column: starts at 62 % of the width, 32 % wide, leaves 5 % or more on the right. */
export const COLUMN = { left: 1190, width: 614 };

export function useEnter(delay = 0) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 22 });
}

/** Chapter heading in the right column: number, accent line, title, optional short line. */
export function RightSectionHeading({ number, title, subtitle, delay = 6, shadow = false }: { number: string; title: string; subtitle?: string; delay?: number; shadow?: boolean }) {
  const enter = useEnter(delay);
  const textShadow = shadow ? "0 2px 18px rgba(0,0,0,0.75)" : undefined;
  return (
    <div style={{
      position: "absolute", left: COLUMN.left, top: 162, width: COLUMN.width, opacity: enter,
      transform: `translateX(${interpolate(enter, [0, 1], [28, 0])}px)`,
    }}>
      <div style={{ fontFamily: mono, fontWeight: 500, fontSize: 30, color: color.cyan, textShadow }}>{number}</div>
      <div style={{ width: 64, height: 3, margin: "10px 0 14px", background: color.cyan, borderRadius: 2 }} />
      <div style={{ fontFamily: sans, fontWeight: 800, fontSize: 62, lineHeight: 1.06, letterSpacing: -1, color: "#fff", textShadow }}>{title}</div>
      {subtitle && <div style={{ marginTop: 12, fontFamily: sans, fontWeight: 500, fontSize: 30, lineHeight: 1.25, color: color.muted, textShadow }}>{subtitle}</div>}
    </div>
  );
}

/** Short UI note. Sits in the right column, so that it never covers the footage. */
export function Caption({ text, step, style }: { text: string; step?: string; style?: CSSProperties }) {
  const enter = useEnter(4);
  return (
    <div style={{
      position: "absolute", left: COLUMN.left, top: 396, width: COLUMN.width, display: "flex", gap: 16, alignItems: "baseline",
      opacity: enter, transform: `translateY(${interpolate(enter, [0, 1], [12, 0])}px)`, ...style,
    }}>
      {step && <span style={{ fontFamily: mono, fontWeight: 500, fontSize: 28, color: color.cyan }}>{step}</span>}
      <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 32, color: color.text, lineHeight: 1.25 }}>{text}</span>
    </div>
  );
}

/** Small, quiet source label, always in the top left, away from the chapter heading. */
export function SourceBadge({ text, belowCard = false }: { text: string; belowCard?: boolean }) {
  return (
    <div style={{
      position: "absolute", top: belowCard ? CARD.top + CARD.height + 6 : 78, left: belowCard ? CARD.left : 70, padding: "6px 12px", borderRadius: 6, background: "rgba(7,12,22,0.46)",
      fontFamily: mono, fontWeight: 500, fontSize: 20, color: "rgba(238,244,255,0.82)",
    }}>{text}</div>
  );
}

/** Marks footage as real capture, and states any shortened wait. */
export function CaptureBadge({ note, source = "Real HoloLens 2 capture", belowCard }: { note?: string; source?: string; belowCard?: boolean }) {
  return <SourceBadge text={note ? `${source} · ${note}` : source} belowCard={belowCard} />;
}

export function VideoCard({ children }: { children: ReactNode }) {
  return (
    <div style={{
      position: "absolute", ...CARD, borderRadius: 14, overflow: "hidden", background: "#000",
      boxShadow: "0 18px 50px rgba(0,0,0,0.45), 0 0 0 1px rgba(63,208,255,0.16)",
    }}>{children}</div>
  );
}

export function FadeScene({ duration, children }: { duration: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10, duration - 10, duration], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity, background: color.bg }}>{children}</AbsoluteFill>;
}

/** Faint tracking grid behind cards and diagrams. */
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
