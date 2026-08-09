import React, { createContext, useContext, useEffect, useState } from "react";
import api from "./api";
import { hydratePipeline } from "@/components/leads/constants";

// Fetches the global CRM pipeline config once (per authenticated session),
// hydrates the shared lead-stage metadata (labels/order/visibility), then
// bumps a version so the whole authenticated subtree re-renders and picks up
// the custom labels/order.
const PipelineCtx = createContext(0);

export function PipelineProvider({ children }) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let mounted = true;
    api.get("/pipeline")
      .then(({ data }) => {
        if (!mounted) return;
        hydratePipeline(data?.stages);
        setVersion((v) => v + 1);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);
  return <PipelineCtx.Provider value={version}>{children}</PipelineCtx.Provider>;
}

export const usePipelineVersion = () => useContext(PipelineCtx);
