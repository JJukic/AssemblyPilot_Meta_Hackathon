import { Audio, Sequence, getStaticFiles, staticFile, useVideoConfig } from "remotion";
import timing from "../voice-timing.json";

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
