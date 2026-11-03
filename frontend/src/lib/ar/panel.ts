/** Pure panel text layout helpers (testable without a canvas). */

export function wrapText(text: string, maxChars: number): string[] {
  const words = (text ?? "").split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    // Hard-split very long words so they never overflow the panel.
    let rest = word;
    while (rest.length > maxChars) {
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    if (!rest) continue;
    const candidate = line ? `${line} ${rest}` : rest;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = rest;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export function paginate<T>(items: T[], perPage: number): T[][] {
  const size = Math.max(1, Math.floor(perPage) || 1);
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages.length ? pages : [[]];
}

export type VerificationStatus = "verified" | "not_verified" | "uncertain";

export function verificationLabel(status: VerificationStatus): string {
  if (status === "verified") return "✓ VERIFIED (camera inspection)";
  if (status === "uncertain") return "? UNCERTAIN — verify with a photo";
  return "○ NOT VERIFIED";
}
