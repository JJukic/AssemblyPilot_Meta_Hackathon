import type { Snapshot } from "@/types/assembly";

export function snapshotFile(snapshot: Snapshot, filename: string): File {
  const encoded = snapshot.dataUrl.split(",")[1];
  if (!snapshot.dataUrl.startsWith("data:image/jpeg;base64,") || !encoded) {
    throw new Error("Capture a new JPEG frame before using this photo.");
  }
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return new File([bytes], filename, { type: "image/jpeg" });
}
