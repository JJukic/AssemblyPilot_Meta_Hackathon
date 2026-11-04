import { Audio, Series, Sequence, getStaticFiles, staticFile } from "remotion";
import { frames, type Sfx as SfxName, type Shot } from "../manifest";
import { Clip } from "./Clip";
import { Caption, CaptureBadge, VideoCard } from "./Overlays";

/** Kept low: UI sounds play under the voice-over. */
const VOLUME: Record<SfxName, number> = { whoosh: 0.22, tick: 0.28, confirm: 0.4, alert: 0.3 };

export function Sfx({ name, delay = 0 }: { name: SfxName; delay?: number }) {
  const file = `audio/${name}.wav`;
  if (!getStaticFiles().some((f) => f.name === file)) return null;
  return <Sequence from={delay} layout="none"><Audio src={staticFile(file)} volume={VOLUME[name]} /></Sequence>;
}

export function ShotView({ shot, caption = true, split = false }: { shot: Shot; caption?: boolean; split?: boolean }) {
  return (
    <>
      {split ? <VideoCard><Clip shot={shot} /></VideoCard> : <Clip shot={shot} />}
      {caption && <CaptureBadge note={shot.note} source={shot.badge} belowCard={split} />}
      {caption && shot.caption && <Caption text={shot.caption} step={shot.step} />}
      {shot.sfx && <Sfx name={shot.sfx} />}
    </>
  );
}

export function ShotSeries({ shots, caption = true, split = false }: { shots: Shot[]; caption?: boolean; split?: boolean }) {
  return (
    <Series>
      {shots.map((shot) => (
        <Series.Sequence key={shot.id} durationInFrames={frames(shot.dur)} name={shot.id}>
          <ShotView shot={shot} caption={caption} split={split} />
        </Series.Sequence>
      ))}
    </Series>
  );
}
