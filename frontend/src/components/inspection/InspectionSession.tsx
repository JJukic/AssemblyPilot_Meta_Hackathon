"use client";
import { createContext, useCallback, useContext, useState } from "react";
import type { InspectionRecord } from "@/types/inspection";

const MAX_HISTORY = 10;
interface Session {
  entries: InspectionRecord[];
  add: (entry: Omit<InspectionRecord, "id">) => void;
  clear: () => void;
}
const Context = createContext<Session | null>(null);

// Root-layout memory survives client navigation, but never persists photos in browser storage.
export function InspectionSessionProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<InspectionRecord[]>([]);
  const add = useCallback((entry: Omit<InspectionRecord, "id">) => {
    const record = { ...entry, id: crypto.randomUUID() };
    setEntries((previous) => [record, ...previous].slice(0, MAX_HISTORY));
  }, []);
  const clear = useCallback(() => setEntries([]), []);
  return <Context.Provider value={{ entries, add, clear }}>{children}</Context.Provider>;
}
export function useInspectionSession() {
  const session = useContext(Context);
  if (!session) throw new Error("Inspection session provider is required");
  return session;
}
