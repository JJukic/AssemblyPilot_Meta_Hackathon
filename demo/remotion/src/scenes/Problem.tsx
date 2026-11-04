import { AbsoluteFill } from "remotion";
import { problemShot } from "../manifest";
import { CaptureBadge, COLUMN, RightSectionHeading, useEnter } from "../components/Overlays";
import { Clip } from "../components/Clip";
import { sans } from "../theme";

const QUESTIONS = ["Is this the right brick?", "Is it in the right position?", "What if a step goes wrong?", "Can I move on?"];

function Question({ text, delay }: { text: string; delay: number }) {
  const enter = useEnter(delay);
  return (
    <div style={{
      fontFamily: sans, fontWeight: 700, fontSize: 36, color: "#fff", opacity: enter, textShadow: "0 2px 14px rgba(0,0,0,0.8)",
      transform: `translateX(${(1 - enter) * 24}px)`, padding: "8px 0",
    }}>{text}</div>
  );
}

export function Problem() {
  return (
    <AbsoluteFill>
      <Clip shot={problemShot} />
      <AbsoluteFill style={{ background: "linear-gradient(270deg, rgba(5,9,17,0.25) 0%, rgba(5,9,17,0.22) 34%, transparent 48%)" }} />
      <CaptureBadge />
      <RightSectionHeading number="02" title="THE PROBLEM" subtitle="A printed manual cannot answer." delay={150} shadow />
      <div style={{ position: "absolute", left: COLUMN.left, top: 396, width: COLUMN.width }}>
        {QUESTIONS.map((text, index) => <Question key={text} text={text} delay={40 + index * 44} />)}
      </div>
    </AbsoluteFill>
  );
}
