import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { greetingForNow } from "@/lib/format";
import { Card } from "@/components/ui/card";
import {
  Target, UsersThree, TrendUp, ClockCountdown, ArrowUpRight, Plus, UserPlus,
} from "@phosphor-icons/react";
import { Link, useNavigate } from "react-router-dom";
import { StatCard } from "@/components/dashboard/StatCard";
import AnnouncementBanners from "@/components/messages/AnnouncementBanners";
import LeadFunnel from "@/components/leads/LeadFunnel";
import { statusLabel } from "@/components/leads/constants";

const OPEN_STATUSES = ["new", "not_connected", "interested", "follow_up"];
const CONVERTED_STATUSES = ["converted", "application_submitted", "admission_confirmed", "fee_paid", "completed"];

const STATUS_TONE = {
  converted: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30",
  application_submitted: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:border-teal-500/30",
  admission_confirmed: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30",
  fee_paid: "bg-lime-50 text-lime-700 border-lime-200 dark:bg-lime-500/15 dark:text-lime-300 dark:border-lime-500/30",
  completed: "bg-green-50 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30",
  interested: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30",
  follow_up: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30",
  new: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30",
  lost: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30",
};

function StatusBadge({ status }) {
  const tone = STATUS_TONE[status] || "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider border shrink-0 ${tone}`}>
      {statusLabel(status)}
    </span>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const greeting = useMemo(() => greetingForNow(), []);
  const role = user?.role;
  const canLeads = ["super_admin", "office_admin", "staff"].includes(role);
  const canContacts = ["super_admin", "office_admin"].includes(role);

  const [stats, setStats] = useState({ total: 0, by_status: {}, missed: 0 });
  const [leads, setLeads] = useState([]);
  const [contacts, setContacts] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const calls = [
          canLeads ? api.get("/leads/stats") : Promise.resolve({ data: { total: 0, by_status: {}, missed: 0 } }),
          canLeads ? api.get("/leads") : Promise.resolve({ data: [] }),
          canContacts ? api.get("/clients") : Promise.resolve({ data: [] }),
        ];
        const [s, l, c] = await Promise.all(calls);
        setStats(s.data || { total: 0, by_status: {}, missed: 0 });
        setLeads(Array.isArray(l.data) ? l.data : []);
        setContacts(Array.isArray(c.data) ? c.data : []);
      } catch (e) {
        console.error("[crm-dashboard] load failed:", e?.message || e);
      }
    })();
  }, [canLeads, canContacts]);

  const totals = useMemo(() => {
    const by = stats.by_status || {};
    const open = OPEN_STATUSES.reduce((n, k) => n + (by[k] || 0), 0);
    const converted = CONVERTED_STATUSES.reduce((n, k) => n + (by[k] || 0), 0);
    const rate = stats.total > 0 ? Math.round((converted / stats.total) * 100) : 0;
    return { open, converted, rate };
  }, [stats]);

  const recentLeads = useMemo(
    () => [...leads]
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
      .slice(0, 6),
    [leads]
  );
  const recentContacts = useMemo(
    () => [...contacts]
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
      .slice(0, 6),
    [contacts]
  );

  return (
    <div className="space-y-7 animate-fade-in" data-testid="dashboard-page">
      <AnnouncementBanners />

      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="label-eyebrow">Overview</p>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight mt-2" data-testid="dashboard-greeting">
            {greeting}, {user?.name?.split(" ")[0] || "there"}.
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Here's how your pipeline is looking today.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canLeads && (
            <Link to="/leads?new=1" data-testid="quick-add-lead" className="inline-flex items-center gap-2 h-10 px-4 rounded-lg btn-amber text-sm font-medium">
              <Plus size={16} weight="bold" /> Add lead
            </Link>
          )}
          {canContacts && (
            <Link to="/clients?new=1" data-testid="quick-add-contact" className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-border bg-card text-sm hover:bg-muted lift">
              <UserPlus size={16} /> Add contact
            </Link>
          )}
        </div>
      </header>

      {/* KPI tiles */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="crm-kpis">
        <StatCard testId="kpi-total-leads" eyebrow="Total leads" value={String(stats.total || 0)} palette="amber" icon={Target}
          hint="All leads in your pipeline" onClick={() => nav("/leads")} />
        <StatCard testId="kpi-open-leads" eyebrow="Open leads" value={String(totals.open)} palette="sky" icon={TrendUp}
          hint={OPEN_STATUSES.map((k) => statusLabel(k)).join(" · ")} onClick={() => nav("/leads")} />
        <StatCard testId="kpi-converted" eyebrow="Converted" value={String(totals.converted)} palette="emerald" icon={ArrowUpRight}
          hint={`${totals.rate}% conversion rate`} onClick={() => nav("/leads?filter=converted")} />
        <StatCard testId="kpi-missed" eyebrow="Missed follow-ups" value={String(stats.missed || 0)} palette="rose" icon={ClockCountdown}
          hint="Overdue follow-ups" onClick={() => nav("/leads?filter=missed")} />
      </section>

      {/* Funnel */}
      {canLeads && <LeadFunnel />}

      {/* Recent leads + contacts */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border border-border bg-card rounded-xl shadow-none" data-testid="recent-leads-card">
          <div className="p-5 flex items-center justify-between border-b border-border/60">
            <div>
              <p className="label-eyebrow">Pipeline</p>
              <h3 className="font-display text-lg mt-1 flex items-center gap-2"><Target size={18} className="text-orange-600 dark:text-orange-400" /> Recent leads</h3>
            </div>
            <Link to="/leads" className="text-sm text-foreground hover:text-foreground underline underline-offset-4" data-testid="recent-leads-view-all">View all →</Link>
          </div>
          {recentLeads.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground" data-testid="recent-leads-empty">
              No leads yet. Add your first lead to get started.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recentLeads.map((l) => (
                <Link key={l.id} to={`/leads?lead=${l.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-muted/30 transition-colors" data-testid={`recent-lead-${l.id}`}>
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-foreground truncate">{l.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{l.course || l.place || l.phone || "—"}</p>
                  </div>
                  <StatusBadge status={l.status} />
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card className="border border-border bg-card rounded-xl shadow-none" data-testid="recent-contacts-card">
          <div className="p-5 flex items-center justify-between border-b border-border/60">
            <div>
              <p className="label-eyebrow">Directory</p>
              <h3 className="font-display text-lg mt-1 flex items-center gap-2"><UsersThree size={18} className="text-orange-600 dark:text-orange-400" /> Recent contacts</h3>
            </div>
            {canContacts && <Link to="/clients" className="text-sm text-foreground hover:text-foreground underline underline-offset-4" data-testid="recent-contacts-view-all">View all →</Link>}
          </div>
          {recentContacts.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground" data-testid="recent-contacts-empty">
              {canContacts ? "No contacts yet. Add a contact to build your directory." : "Contacts are managed by your administrators."}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recentContacts.map((c) => (
                <Link key={c.id} to={`/clients/${c.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-muted/30 transition-colors" data-testid={`recent-contact-${c.id}`}>
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-foreground truncate">{c.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{c.email || c.phone || c.client_type || "—"}</p>
                  </div>
                  <ArrowUpRight size={14} className="text-muted-foreground shrink-0" />
                </Link>
              ))}
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
