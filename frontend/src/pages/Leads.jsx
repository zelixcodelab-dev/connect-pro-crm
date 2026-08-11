import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import api from "@/lib/api";
import LeadsPipeline from "@/components/leads/LeadsPipeline";
import TodayVisitsPanel from "@/components/leads/TodayVisitsPanel";
import LeadDetailDialog from "@/components/leads/LeadDetailDialog";

const OFFICES = [["all", "All offices"], ["HEAD_OFFICE", "HEAD OFFICE"], ["BRANCH_EKM", "BRANCH EKM"], ["BRANCH_TVM", "BRANCH TVM"]];

export default function Leads() {
  const { user } = useAuth();
  const isStaff = user?.role === "staff";
  const isSuper = user?.role === "super_admin";
  const [params, setParams] = useSearchParams();

  const [officeOverride, setOfficeOverride] = useState(() => {
    if (typeof window === "undefined") return "all";
    return localStorage.getItem("crm.office_override") || "all";
  });
  const updateOffice = useCallback((v) => {
    setOfficeOverride(v);
    try { localStorage.setItem("crm.office_override", v); } catch { /* no-op */ }
  }, []);
  const activeOffice = isSuper ? officeOverride : "all";

  const [deepLead, setDeepLead] = useState(null);
  const [pipelineRefreshKey, setPipelineRefreshKey] = useState(0);
  const leadParam = params.get("lead");

  useEffect(() => {
    if (!leadParam) return;
    let cancelled = false;
    api.get(`/leads`, { params: { q: leadParam } })
      .then(({ data }) => {
        if (cancelled) return;
        const hit = (data || []).find((l) => l.id === leadParam);
        if (hit) setDeepLead(hit);
        else {
          api.get(`/leads`).then(({ data: all }) => {
            if (cancelled) return;
            const h = (all || []).find((l) => l.id === leadParam);
            if (h) setDeepLead(h);
          }).catch(() => {});
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [leadParam]);

  const closeDeepLink = useCallback(() => {
    setDeepLead(null);
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("lead");
      return next;
    }, { replace: true });
  }, [setParams]);

  const bumpPipeline = useCallback(() => setPipelineRefreshKey((k) => k + 1), []);

  return (
    <div className="space-y-6" data-testid="leads-page">
      <div className="flex items-start sm:items-center justify-between gap-3 flex-col sm:flex-row">
        <div>
          <p className="label-eyebrow">CRM</p>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">{isStaff ? "My Leads" : "Leads"}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isStaff ? "Your assigned prospects and follow-ups." : "Every lead in one board — filter, assign and move them through the pipeline."}
          </p>
        </div>
        {isSuper && (
          <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5 self-start sm:self-auto shrink-0" data-testid="crm-office-switcher">
            {OFFICES.map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => updateOffice(v)}
                data-testid={`crm-office-${v}`}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  officeOverride === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {isStaff ? (
        <>
          <TodayVisitsPanel user={user} />
          <LeadsPipeline user={user} refreshKey={pipelineRefreshKey} />
        </>
      ) : (
        <div data-testid="crm-all-leads">
          <LeadsPipeline user={user} allLeadsMode refreshKey={pipelineRefreshKey} officeOverride={activeOffice} />
        </div>
      )}

      <LeadDetailDialog
        open={!!deepLead}
        onOpenChange={(v) => { if (!v) closeDeepLink(); }}
        lead={deepLead}
        user={user}
        onChanged={() => { bumpPipeline(); }}
      />
    </div>
  );
}
