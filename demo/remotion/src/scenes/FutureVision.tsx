import { AbsoluteFill, Img, interpolate, staticFile } from "remotion";
import { Grid, RightSectionHeading, useEnter } from "../components/Overlays";
import { SHOT_VERIFIED } from "../manifest";
import { color, mono, sans } from "../theme";

const GOLD = color.amber;
const FIELDS = ["Cooking", "Repairs", "Education", "Industrial training"];

function Block({ delay, label, tone, children }: { delay: number; label: string; tone: string; children: React.ReactNode }) {
  const enter = useEnter(delay);
  return (
    <div style={{ opacity: enter, transform: `translateY(${interpolate(enter, [0, 1], [20, 0])}px)`, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontFamily: mono, fontWeight: 500, fontSize: 24, color: tone }}>{label}</div>
      {children}
    </div>
  );
}

export function FutureVision() {
  return (
    <AbsoluteFill>
      <Grid />
      <div style={{
        position: "absolute", top: 76, right: 116, padding: "7px 14px", borderRadius: 7, border: `1.5px solid ${GOLD}`,
        fontFamily: mono, fontWeight: 500, fontSize: 22, color: GOLD, whiteSpace: "nowrap",
      }}>FUTURE VISION · NOT IMPLEMENTED</div>
      <RightSectionHeading number="08" title="FUTURE VISION" subtitle="Possible applications, not part of this prototype." />
      <div style={{ position: "absolute", left: 90, top: 150, width: 1020, display: "flex", flexDirection: "column", gap: 44 }}>
        <Block delay={9} label="TODAY · REAL PROTOTYPE" tone={color.cyan}>
          <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
            <Img src={staticFile(SHOT_VERIFIED)} style={{ width: 300, height: 169, objectFit: "cover", borderRadius: 10, border: `2px solid ${color.cyan}` }} />
            <div style={{ fontFamily: sans, fontWeight: 800, fontSize: 48, lineHeight: 1.15, color: "#fff" }}>A guided LEGO assembly</div>
          </div>
        </Block>
        <Block delay={114} label="TOMORROW · POSSIBLE" tone={GOLD}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
            {FIELDS.map((text) => <div key={text} style={{ padding: "14px 24px", borderRadius: 10, border: `2px dashed ${GOLD}`, fontFamily: sans, fontWeight: 700, fontSize: 36, color: "#fff" }}>{text}</div>)}
          </div>
        </Block>
        <Block delay={315} label="IMAGINE · CONCEPT" tone={GOLD}>
          <div style={{ fontFamily: sans, fontWeight: 800, fontSize: 48, lineHeight: 1.15, color: "#fff" }}>Learning to cook, with no prior experience</div>
        </Block>
      </div>
    </AbsoluteFill>
  );
}
