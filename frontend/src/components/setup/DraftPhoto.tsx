"use client";
/* eslint-disable @next/next/no-img-element -- Browser-local preview, never a remote URL. */
import { useEffect, useRef, useState } from "react";
import type { ReferenceImage } from "@/types/blocks";
import { mediaUrl } from "@/lib/api";
import { ReferenceCamera } from "@/components/camera/ReferenceCamera";
export function DraftPhoto({ label, file, onChange }: { label: string; file?: File; onChange?: (file?: File) => void }) {
  const [camera, setCamera] = useState(false);
  const preview = useRef<HTMLImageElement>(null);
  const [error, setError] = useState("");
  useEffect(() => { if (!file) return; const next = URL.createObjectURL(file); if (preview.current) preview.current.src = next; return () => URL.revokeObjectURL(next); }, [file]);
  function choose(next?: File) {
    if (next && (next.size > 8 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(next.type))) { setError("Choose a JPEG, PNG or WebP under 8 MiB."); return false; }
    setError(""); onChange?.(next); return true;
  }
  return <section className="draft-photo" aria-label={`Photo: ${label}`}>
    {file && <figure><img ref={preview} alt={label} /><figcaption>{file.name} · selected reference</figcaption></figure>}
    {onChange && <><label className="field">{label}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { if (e.target.files?.[0]) choose(e.target.files[0]); e.target.value = ""; }} /></label>
      <div className="form-actions"><button type="button" className="button secondary" onClick={() => setCamera(!camera)}>Photograph {label.toLowerCase()}</button>{file && <button type="button" className="text-button" onClick={() => choose()}>Remove photo</button>}</div>
      {camera && <ReferenceCamera busy={false} onSave={async (next) => choose(next)} onClose={() => setCamera(false)} />}
      <small>Kept in this draft. Uploaded when you generate a plan or confirm setup.</small></>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function LibraryPhoto({ image }: { image?: ReferenceImage }) {
  if (!image) return null;
  return <figure className="draft-photo"><img src={mediaUrl(image.url)} alt="Existing library reference" /><figcaption>Existing default library reference. New photos are appended; this default remains in use for inspection.</figcaption></figure>;
}
