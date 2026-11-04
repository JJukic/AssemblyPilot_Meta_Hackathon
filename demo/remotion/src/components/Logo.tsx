import { Boxes } from "lucide-react";
import { color, sans } from "../theme";

/** Same elements as frontend/src/components/ui/Brand.tsx: Boxes icon and wordmark. */
export function Logo({ scale = 1 }: { scale?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 30 * scale }}>
      <div style={{
        width: 118 * scale, height: 118 * scale, borderRadius: 26 * scale, display: "grid", placeItems: "center",
        background: `linear-gradient(140deg, ${color.blue}, ${color.cyan})`, color: "#06101f",
        boxShadow: `0 0 ${70 * scale}px rgba(63,208,255,0.35)`,
      }}><Boxes size={70 * scale} strokeWidth={2} /></div>
      <div style={{ fontFamily: sans, fontWeight: 800, fontSize: 100 * scale, letterSpacing: -2 * scale, color: color.text }}>
        Assembly<span style={{ color: color.blue }}>Pilot</span>
      </div>
    </div>
  );
}
