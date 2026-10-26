/* eslint-disable @next/next/no-img-element */
"use client";
import { useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import type { ReferenceImage } from "@/types/blocks";
import { errorMessage, mediaUrl } from "@/lib/api";
import { registry } from "@/lib/registry";

export function ImageManager({ images, endpoint, onChange }: {
  images: ReferenceImage[]; endpoint: string; onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError(null);
    try { await registry.uploadImage(endpoint, file); onChange(); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  async function remove(image: ReferenceImage) {
    if (!window.confirm(`Delete reference photo “${image.original_filename}”?`)) return;
    setBusy(true); setError(null);
    try { await registry.deleteImage(image.id); onChange(); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <section className="image-manager" aria-label="Reference photographs">
    <h3><ImagePlus size={17} /> Reference photographs</h3>
    <p className="muted">Upload a real JPEG, PNG or WebP photo. Photos are saved only when you select a file.</p>
    <div className="image-gallery">
      {images.map((image) => <figure key={image.id}>
        <img src={mediaUrl(image.url)} alt={image.original_filename} />
        <figcaption>{image.width} × {image.height}<button type="button" className="icon-button danger" aria-label={`Delete photo ${image.original_filename}`} disabled={busy} onClick={() => void remove(image)}><Trash2 size={14} /></button></figcaption>
      </figure>)}
    </div>
    {!images.length && <p className="empty-caption">No reference photograph yet.</p>}
    <label className="field"><span>{busy ? "Saving photo…" : "Upload reference photo"}</span>
      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }} />
    </label>
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
