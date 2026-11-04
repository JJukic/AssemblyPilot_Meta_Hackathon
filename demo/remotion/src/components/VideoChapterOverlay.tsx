import type { ReactNode } from "react";
import { Sequence, interpolate, useCurrentFrame } from "remotion";
import { CHAPTER_FADE, chapterStart, chapters, frames } from "../manifest";
import { HeadingBlock, plate, useEnter } from "./Overlays";
import { sans } from "../theme";

type VideoChapterOverlayProps = {
  number: string;
  title: string;
  subtitle: string;
  children?: ReactNode;
  /** Text opacity alone, so that the card can stay while chapters change. */
  textOpacity?: number;
};

/** The one chapter card over real footage. "02 THE PROBLEM" sets the look for every chapter. */
export function VideoChapterOverlay({ number, title, subtitle, children, textOpacity = 1 }: VideoChapterOverlayProps) {
  return (
    <div style={{ ...plate, position: "absolute", left: "62%", width: "32%", top: "16%", padding: "22px 28px" }}>
      <div style={{ opacity: textOpacity }}>
        <HeadingBlock number={number} title={title} subtitle={subtitle} align={{ whiteSpace: "nowrap" }} />
        {children}
      </div>
    </div>
  );
}

const QUESTIONS = ["Is this the right brick?", "Is it in the right position?", "What if a step goes wrong?", "Can I move on?"];

function Question({ text, delay }: { text: string; delay: number }) {
  const enter = useEnter(delay);
  return <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 30, color: "#fff", opacity: enter, padding: "6px 0" }}>{text}</div>;
}

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Neighbouring cards overlap, so the card stays. Their texts take turns, so two titles never mix. */
function Timed({ length, children }: { length: number; children: (textOpacity: number) => ReactNode }) {
  const frame = useCurrentFrame();
  const half = CHAPTER_FADE / 2;
  const card = interpolate(frame, [0, CHAPTER_FADE, length - CHAPTER_FADE, length], [0, 1, 1, 0], clamp);
  const text = interpolate(frame, [half, CHAPTER_FADE, length - CHAPTER_FADE, length - half], [0, 1, 1, 0], clamp);
  return <div style={{ opacity: card }}>{children(text)}</div>;
}

/** All chapter overlays, placed on the global timeline so that a cut never makes them jump. */
export function ChapterTrack() {
  return (
    <>
      {chapters.map((chapter) => {
        const from = frames(chapterStart(chapter.scene, chapter.at)) - CHAPTER_FADE / 2;
        const length = frames(chapter.dur) + CHAPTER_FADE;
        return (
          <Sequence key={chapter.number} from={from} durationInFrames={length} name={`chapter ${chapter.number}`} layout="none">
            <Timed length={length}>
              {(textOpacity) => (
                <VideoChapterOverlay number={chapter.number} title={chapter.title} subtitle={chapter.subtitle} textOpacity={textOpacity}>
                  {chapter.number === "02" && <div style={{ marginTop: 12 }}>{QUESTIONS.map((text, index) => <Question key={text} text={text} delay={40 + index * 44} />)}</div>}
                </VideoChapterOverlay>
              )}
            </Timed>
          </Sequence>
        );
      })}
    </>
  );
}
