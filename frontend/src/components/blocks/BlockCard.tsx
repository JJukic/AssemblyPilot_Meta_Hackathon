/* eslint-disable @next/next/no-img-element */
import { Box, Pencil, Trash2 } from "lucide-react";
import type { BuildingBlock } from "@/types/blocks";
import { mediaUrl } from "@/lib/api";

export function BlockCard({ block, onEdit, onDelete, busy }: {
  block: BuildingBlock; onEdit: () => void; onDelete: () => void; busy: boolean;
}) {
  const firstImage = block.reference_images[0];
  return <article className="block-card panel">
    <div className="block-photo">{firstImage ? <img src={mediaUrl(firstImage.url)} alt={`Reference for ${block.name}`} /> : <><Box size={36} strokeWidth={1.3} /><span>No reference photo</span></>}</div>
    <div className="card-body"><div className="card-title"><h2>{block.name}</h2><span className="tag">{block.category}</span></div>
      <p className="muted">{block.color} · {block.shape}</p>
      <dl className="block-properties"><div><dt>Studs</dt><dd>{block.studs_x ?? "–"} × {block.studs_y ?? "–"}</dd></div><div><dt>Height</dt><dd>{block.height_mm !== null ? `${block.height_mm} mm` : "–"}</dd></div><div><dt>Default qty</dt><dd>{block.default_quantity}</dd></div></dl>
      <div className="card-actions"><span className="muted">{block.reference_images.length} photos</span><button className="button secondary" onClick={onEdit} disabled={busy} aria-label={`Edit ${block.name}`}><Pencil size={14} /> Edit</button><button className="icon-button danger" disabled={busy} onClick={onDelete} aria-label={`Delete ${block.name}`}><Trash2 size={16} /></button></div>
    </div>
  </article>;
}
