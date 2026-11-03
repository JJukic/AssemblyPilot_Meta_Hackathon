"use client";
/* Static, same-origin branding image: a native img keeps it out of image optimization. */
/* eslint-disable @next/next/no-img-element */
import { Boxes } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

/** Transparent, cropped mascot (117 × 168 px, shown at ≤ 48 px height; 3× for HiDPI). */
export const MASCOT_SRC = "/assets/meta-mascot.png";
const MASCOT_W = 117, MASCOT_H = 168;

/**
 * Header branding shared by every page: [AssemblyPilot icon] [Meta mascot] wordmark.
 * The mascot is static (no animation, no action). If the image cannot load it is
 * removed, leaving exactly the previous icon + wordmark layout.
 */
export function Brand({ href }: { href?: string }) {
  const [mascot, setMascot] = useState(true);
  // A server-rendered image can fail BEFORE hydration, when onError is not attached yet:
  // detect an already failed load as soon as the element is mounted.
  const checkLoaded = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth === 0) setMascot(false);
  }, []);
  const content = <>
    <div className="brand-icon"><Boxes size={24} /></div>
    {mascot && <img ref={checkLoaded} className="brand-mascot" src={MASCOT_SRC} alt="Meta mascot" width={MASCOT_W} height={MASCOT_H}
      decoding="async" draggable={false} onError={() => setMascot(false)} />}
    <div><span className="brand-name">Assembly<span>Pilot</span></span><p>Visual Assembly Intelligence</p></div>
  </>;
  return href ? <Link href={href} className="brand">{content}</Link> : <div className="brand">{content}</div>;
}
