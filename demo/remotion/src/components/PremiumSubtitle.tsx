import type { CSSProperties } from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import timing from "../voice-timing.json";
import { color, sans } from "../theme";

/** Voice-over subtitles as a compact glass card. Same cues as subtitles/voiceover.en.srt. */
export function PremiumSubtitle() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;
  const cue = timing.cues.find((c) => seconds >= c.start && seconds < c.end);
  if (!cue) return null;
  const opacity = interpolate(seconds, [cue.start, cue.start + 0.12], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: "8%", display: "flex", justifyContent: "center", pointerEvents: "none", opacity }}>
      <div style={{
        maxWidth: "70%", padding: "11px 24px", borderRadius: 12, borderLeft: `3px solid ${color.cyan}`, background: "rgba(5,15,30,0.62)",
        backdropFilter: "blur(10px)", boxShadow: "0 10px 30px rgba(0,0,0,0.32)", textAlign: "center", textWrap: "balance",
        fontFamily: sans, fontWeight: 700, fontSize: 34, lineHeight: 1.3, color: "#fff",
      } as CSSProperties}>{cue.text}</div>
    </div>
  );
}
