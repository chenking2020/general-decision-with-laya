import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";
import type { EngineInfo } from "./types";

interface Ctx {
  meta: EngineInfo | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const MetaContext = createContext<Ctx>({ meta: null, loading: true, error: null, refresh: () => {} });

export function MetaProvider({ children }: { children: React.ReactNode }) {
  const [meta, setMeta] = useState<EngineInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = React.useCallback(() => {
    setLoading(true);
    api
      .meta()
      .then((m) => {
        setMeta(m);
        setError(null);
      })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  return <MetaContext.Provider value={{ meta, loading, error, refresh }}>{children}</MetaContext.Provider>;
}

export const useMeta = () => useContext(MetaContext);
