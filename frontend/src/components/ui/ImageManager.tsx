/* eslint-disable @next/next/no-img-element */
"use client";
import { useRef, useState } from "react";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { ReferenceCamera } from "@/components/camera/ReferenceCamera";
import type { ReferenceImage } from "@/types/blocks";
import { errorMessage, mediaUrl } from "@/lib/api";
import { registry } from "@/lib/registry";

export function ImageManager({ images, endpoint, onChange, onSelect }: {
  images: ReferenceImage[]; endpoint: string; onChange: () => void;
  onSelect?: (image: ReferenceImage) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const uploading = useRef(false);
  async function upload(file: File | undefined) {
    if (!file || uploading.current) return false;
    uploading.current = true;
    setBusy(true); setError(null); setNotice(null);
    try {
      await registry.uploadImage(endpoint, file);
      onChange(); setNotice("Reference photo saved.");
      return true;
    }
    catch (cause) { setError(errorMessage(cause)); return false; }
    finally { setBusy(false); uploading.current = false; }
  }
  async function remove(image: ReferenceImage) {
    if (!window.confirm(`Delete reference photo “${image.original_filename}”?`)) return;
    setBusy(true); setError(null);
    try { await registry.deleteImage(image.id); onChange(); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  async function select(image: ReferenceImage) {
    if (!onSelect || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await onSelect(image); onChange(); setNotice("Reference photo selected for inspection.");
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <section className="image-manager" aria-label="Reference photographs">
    <h3><ImagePlus size={17} /> Reference photographs</h3>
    <p className="muted">Take a photo with your camera or upload a JPEG, PNG or WebP file.</p>
    <p className="muted">{onSelect ? "Choose which photo shows the correct arrangement for this step. The selected photo is used in the workspace and inspection." : "The first reference photo is used for inspection. Delete it to use the next photo."}</p>
    <div className="image-gallery">
      {images.map((image, index) => <figure key={image.id}>
        <img src={mediaUrl(image.url)} alt={image.original_filename} />
        {index === 0 && <span className="reference-used">Used for inspection</span>}
        {onSelect && <button type="button" className="text-button reference-select" disabled={busy || index === 0}
          aria-label={`Use photo ${image.original_filename} for inspection`} aria-pressed={index === 0}
          onClick={() => void select(image)}>{index === 0 ? "Selected" : "Use for inspection"}</button>}
        <figcaption>{image.width} × {image.height}<button type="button" className="icon-button danger" aria-label={`Delete photo ${image.original_filename}`} disabled={busy} onClick={() => void remove(image)}><Trash2 size={14} /></button></figcaption>
      </figure>)}
    </div>
    {!images.length && <p className="empty-caption">No reference photograph yet.</p>}
    {!cameraOpen && <button type="button" className="button secondary" disabled={busy} onClick={() => { setCameraOpen(true); setError(null); setNotice(null); }}>
      <Camera size={16} /> Take reference photo
    </button>}
    {cameraOpen && <ReferenceCamera busy={busy} onSave={upload} onClose={() => setCameraOpen(false)} />}
    <label className="field"><span>{busy ? "Saving photo…" : "Upload reference photo"}</span>
      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }} />
    </label>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="success-note" role="status">{notice}</p>}
  </section>;
}
