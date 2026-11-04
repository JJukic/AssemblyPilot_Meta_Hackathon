import { AbsoluteFill } from "remotion";
import { problemShot } from "../manifest";
import { CaptureBadge, Headline, useEnter } from "../components/Overlays";
import { Clip } from "../components/Clip";
import { color, sans } from "../theme";

const QUESTIONS = ["Is this the right brick?", "Is it in the right position?", "What if a step goes wrong?", "Can I move on?"];

function Question({ text, delay }: { text: string; delay: number }) {
  const enter = useEnter(delay);
  return (
    <div style={{
      fontFamily: sans, fontWeight: 700, fontSize: 52, color: color.text, opacity: enter,
      transform: `translateX(${(1 - enter) * -30}px)`, padding: "14px 0",
    }}>{text}</div>
  );
}

export function Problem() {
  return (
    <AbsoluteFill>
      <Clip shot={problemShot} />
      <AbsoluteFill style={{ background: "linear-gradient(90deg, rgba(5,9,17,0.92) 0%, rgba(5,9,17,0.78) 48%, rgba(5,9,17,0.1) 78%)" }} />
      <CaptureBadge />
      <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 110 }}>
        {QUESTIONS.map((text, index) => <Question key={text} text={text} delay={10 + index * 44} />)}
        <Headline text="A printed manual cannot answer." size={56} delay={240} tone={color.cyan} style={{ textAlign: "left", marginTop: 34 }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
