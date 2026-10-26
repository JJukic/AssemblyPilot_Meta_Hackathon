/* eslint-disable @next/next/no-img-element */
"use client";

import { ImagePlus } from "lucide-react";
import { useState } from "react";

export function ReferenceImage({ path, title }: { path: string | null; title: string }) {
  const [failed, setFailed] = useState(false);
  if (!path || failed) {
    return (
      <div className="reference-placeholder">
        <ImagePlus size={22} strokeWidth={1.5} />
        <div><strong>Reference photograph needed</strong><p>Add a photo for this step to compare your build.</p></div>
      </div>
    );
  }
  return <img className="reference-image" src={path} alt={`Reference for ${title}`} onError={() => setFailed(true)} />;
}
