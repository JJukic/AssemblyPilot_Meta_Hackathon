import { Audio, Sequence, getStaticFiles, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import timing from "../voice-timing.json";
import { color, sans } from "../theme";

/** Speech level. All eight lines share it, so the voice stays consistent. */
const VOICE_VOLUME = 1.5;
const MUSIC_UNDER_VOICE = 0.1;
const MUSIC_ALONE = 0.42;
const DUCK_SECONDS = 0.5;

/** Music level for a moment in time: low under speech, with a short ramp on either side. */
export function musicLevel(seconds: number) {
  const distance = Math.min(...timing.placements.map((p) => Math.max(p.start - seconds, seconds - p.end, 0)));
  return MUSIC_UNDER_VOICE + (MUSIC_ALONE - MUSIC_UNDER_VOICE) * Math.min(distance / DUCK_SECONDS, 1);
}

export function VoiceTrack() {
  const { fps } = useVideoConfig();
  const available = getStaticFiles();
  return (
    <>
      {timing.placements.filter((p) => available.some((file) => file.name === p.file)).map((p) => (
        <Sequence key={`${p.voice}-${p.start}`} from={Math.round(p.start * fps)} durationInFrames={Math.ceil((p.end - p.start) * fps)} name={`voice ${p.voice}`} layout="none">
          <Audio src={staticFile(p.file)} volume={VOICE_VOLUME} trimBefore={p.trimBefore} {...("trimAfter" in p && p.trimAfter !== undefined ? { trimAfter: p.trimAfter } : {})} />
        </Sequence>
      ))}
    </>
  );
}

/** Burned-in English subtitles, from the same cues as subtitles/voiceover.en.srt. */
export function Subtitles() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;
  const cue = timing.cues.find((c) => seconds >= c.start && seconds < c.end);
  if (!cue) return null;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 40, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <div style={{
        maxWidth: 1480, padding: "10px 26px", borderRadius: 8, background: "rgba(5,9,17,0.84)", textAlign: "center",
        fontFamily: sans, fontWeight: 600, fontSize: 38, lineHeight: 1.26, color: color.text,
      }}>{cue.text}</div>
    </div>
  );
}
