"use client";
import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "@/lib/api";

export function useResource<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    load().then((result) => {
      if (active) { setData(result); setError(null); }
    }).catch((cause: unknown) => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [load, revision]);
  return { data, error, reload };
}
