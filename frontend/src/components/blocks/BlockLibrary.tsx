"use client";
import { useState } from "react";
import { Box, Plus, Search } from "lucide-react";
import { useResource } from "@/hooks/useResource";
import { registry } from "@/lib/registry";
import { errorMessage } from "@/lib/api";
import { ImageManager } from "@/components/ui/ImageManager";
import { BlockCard } from "./BlockCard";
import { BlockForm } from "./BlockForm";
import { FaceEditor } from "./FaceEditor";

export function BlockLibrary() {
  const { data, error, reload } = useResource(registry.blocks);
  const [query, setQuery] = useState("");
  const [color, setColor] = useState("");
  const [category, setCategory] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const selected = data?.find((block) => block.id === editing);
  const filtered = data?.filter((block) =>
    `${block.name} ${block.color} ${block.category}`.toLowerCase().includes(query.toLowerCase()) &&
    (!color || block.color === color) && (!category || block.category === category));
  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete “${name}” and its reference photos? Blocks used in steps cannot be deleted.`)) return;
    setBusy(true); setActionError(null);
    try { await registry.deleteBlock(id); if (editing === id) setEditing(null); reload(); setNotice("Block deleted."); }
    catch (cause) { setActionError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <>
    <div className="collection-toolbar"><label className="search-box"><Search size={17} /><input aria-label="Search blocks" placeholder="Search name, color or category…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <select aria-label="Filter by color" value={color} onChange={(event) => setColor(event.target.value)}><option value="">All colors</option>{Array.from(new Set(data?.map((b) => b.color))).sort().map((value) => <option key={value}>{value}</option>)}</select>
      <select aria-label="Filter by category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{Array.from(new Set(data?.map((b) => b.category))).sort().map((value) => <option key={value}>{value}</option>)}</select>
      <button className="button primary" onClick={() => { setEditing("new"); setNotice(null); }}><Plus size={16} /> Add block</button>
    </div>
    {(error || actionError) && <div className="form-error" role="alert">{actionError || error} <button className="text-button" onClick={reload}>Retry loading</button></div>}
    {notice && <p role="status" className="success-note">{notice}</p>}
    <div className={`collection-layout ${editing ? "has-editor" : ""}`}>
      <div>
        {!data && !error && <p role="status" className="empty-state">Loading your blocks…</p>}
        {data && !data.length && <div className="empty-state"><Box size={32} /><h2>Your block library starts here</h2><p>Register a block once, then reuse it across all your assembly projects.</p></div>}
        {!!data?.length && !filtered?.length && <p className="empty-state">No blocks match these filters.</p>}
        <div className="block-grid">{filtered?.map((block) => <BlockCard key={block.id} block={block} busy={busy} onEdit={() => { setEditing(block.id); setNotice(null); }} onDelete={() => void remove(block.id, block.name)} />)}</div>
      </div>
      {editing && <aside className="panel editor-panel"><div className="panel-heading"><h2>{editing === "new" ? "Register a block" : "Edit block"}</h2></div>
        {editing === "new" || selected ? <>
          <BlockForm key={editing} block={selected} onCancel={() => setEditing(null)} onSave={async (input) => {
            const saved = await registry.saveBlock(input, selected?.id);
            reload(); setEditing(saved.id); setNotice("Block saved. You can now add reference photographs.");
          }} />
          {selected && <ImageManager key={`images:${selected.id}`} images={selected.reference_images} endpoint={`/api/blocks/${selected.id}/images`} onChange={reload} />}
          {selected && <FaceEditor key={`faces:${selected.id}`} blockId={selected.id} />}
        </> : <p className="empty-state">Loading saved block…</p>}
      </aside>}
    </div>
  </>;
}
