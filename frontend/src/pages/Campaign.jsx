import React from "react";
import { useAuth } from "@/lib/auth";
import CampaignsPanel from "@/components/leads/CampaignsPanel";

// Campaign workspace (admins). The all-leads board lives on the separate
// "Leads" page — this page is dedicated to running campaigns.
export default function Campaign() {
  const { user } = useAuth();
  return (
    <div className="space-y-6" data-testid="campaign-page">
      <div>
        <p className="label-eyebrow">CRM</p>
        <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">Campaign</h1>
        <p className="text-sm text-muted-foreground mt-1">Create campaigns and work their pipeline.</p>
      </div>
      <CampaignsPanel user={user} />
    </div>
  );
}
