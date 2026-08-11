import React, { useCallback, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { greetingForNow } from "@/lib/format";
import AnnouncementBanners from "@/components/messages/AnnouncementBanners";
import StaffPerformancePanel from "@/components/leads/StaffPerformancePanel";
import TodayVisitsPanel from "@/components/leads/TodayVisitsPanel";
import CrmAnalytics from "@/components/office-dashboard/CrmAnalytics";

const OFFICES = [["all", "All offices"], ["HEAD_OFFICE", "HEAD OFFICE"], ["BRANCH_EKM", "BRANCH EKM"], ["BRANCH_TVM", "BRANCH TVM"]];

export default function Dashboard() {
  const { user } = useAuth();
  const greeting = useMemo(() => greetingForNow(), []);
  const role = user?.role;
  const isSuper = role === "super_admin";
  const isAdmin = role === "super_admin" || role === "office_admin";
  const isStaff = role === "staff";

  // Super Admin office scope (shared with the CRM page via localStorage).
  const [officeOverride, setOfficeOverride] = useState(() => {
    if (typeof window === "undefined") return "all";
    return localStorage.getItem("crm.office_override") || "all";
  });
  const updateOffice = useCallback((v) => {
    setOfficeOverride(v);
    try { localStorage.setItem("crm.office_override", v); } catch { /* no-op */ }
  }, []);
  const activeOffice = isSuper ? officeOverride : "all";

  return (
    <div className="space-y-6 animate-fade-in" data-testid="dashboard-page">
      <AnnouncementBanners />

      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="label-eyebrow">Overview</p>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight mt-2" data-testid="dashboard-greeting">
            {greeting}, {user?.name?.split(" ")[0] || "there"}.
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Your CRM performance at a glance.</p>
        </div>
        {isSuper && (
          <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5 self-start sm:self-auto shrink-0" data-testid="overview-office-switcher">
            {OFFICES.map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => updateOffice(v)}
                data-testid={`overview-office-${v}`}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  officeOverride === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </header>

      {isAdmin ? (
        <div className="space-y-5" data-testid="crm-overview">
          <StaffPerformancePanel officeOverride={activeOffice} />
          <TodayVisitsPanel user={user} officeOverride={activeOffice} />
          <CrmAnalytics office={activeOffice === "all" ? null : activeOffice} />
        </div>
      ) : isStaff ? (
        <div className="space-y-5" data-testid="crm-overview">
          <TodayVisitsPanel user={user} />
        </div>
      ) : (
        <div className="text-sm text-muted-foreground" data-testid="overview-empty">
          Welcome. Use the sidebar to navigate your workspace.
        </div>
      )}
    </div>
  );
}
