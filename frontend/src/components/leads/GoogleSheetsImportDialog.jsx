import React, { useCallback, useEffect, useMemo, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { GoogleLogo, ArrowClockwise, MagnifyingGlass, CheckCircle, WarningCircle, ClockCounterClockwise } from "@phosphor-icons/react";

const STATUS_META = {
  new: { label: "New Lead", cls: "bg-emerald-100/60 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  duplicate_crm: { label: "In CRM", cls: "bg-amber-100/60 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  duplicate_campaign: { label: "In campaign", cls: "bg-slate-100 dark:bg-slate-500/15 text-slate-600 dark:text-slate-300" },
  duplicate_sheet: { label: "Already imported", cls: "bg-slate-100 dark:bg-slate-500/15 text-slate-600 dark:text-slate-300" },
  invalid_phone: { label: "Invalid phone", cls: "bg-rose-100/60 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400" },
  invalid_email: { label: "Invalid email", cls: "bg-rose-100/60 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400" },
  invalid: { label: "Invalid", cls: "bg-rose-100/60 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400" },
};

export default function GoogleSheetsImportDialog({ open, onOpenChange, campaignId, campaignName, onImported }) {
  const [status, setStatus] = useState(null);
  const [spreadsheets, setSpreadsheets] = useState([]);
  const [worksheets, setWorksheets] = useState([]);
  const [ssId, setSsId] = useState("");
  const [wsTitle, setWsTitle] = useState("");
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [includeExisting, setIncludeExisting] = useState(false);
  const [enableSync, setEnableSync] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [history, setHistory] = useState([]);

  const reset = useCallback(() => {
    setRows([]); setCounts(null); setSelected(new Set()); setSearch(""); setFilter("all");
    setLastSync(null); setIncludeExisting(false); setEnableSync(false);
  }, []);

  const loadHistory = useCallback(async () => {
    try { const { data } = await api.get("/google/imports", { params: { campaign_id: campaignId } }); setHistory(data.imports || []); }
    catch { /* ignore */ }
  }, [campaignId]);

  useEffect(() => {
    if (!open) return;
    reset(); setSsId(""); setWsTitle(""); setWorksheets([]);
    (async () => {
      setLoading(true);
      try {
        const { data: st } = await api.get("/google/status");
        setStatus(st);
        if (st.connected) {
          const { data } = await api.get("/google/spreadsheets");
          setSpreadsheets(data.spreadsheets || []);
        }
      } catch { setStatus({ connected: false }); }
      finally { setLoading(false); }
    })();
    loadHistory();
  }, [open, reset, loadHistory]);

  const pickSpreadsheet = async (id) => {
    setSsId(id); setWsTitle(""); setWorksheets([]); reset();
    try {
      const { data } = await api.get(`/google/spreadsheets/${id}/worksheets`);
      setWorksheets(data.worksheets || []);
      if (data.worksheets?.length === 1) setWsTitle(data.worksheets[0].title);
    } catch (e) { toast.error(formatApiError(e?.response?.data?.detail) || "Could not load worksheets"); }
  };

  const fetchLeads = async () => {
    if (!ssId || !wsTitle) { toast.error("Pick a spreadsheet and worksheet"); return; }
    setFetching(true);
    try {
      const { data } = await api.post("/google/fetch-leads", { spreadsheet_id: ssId, worksheet_title: wsTitle, campaign_id: campaignId });
      setRows(data.rows || []);
      setCounts(data.counts || null);
      setLastSync(data.last_sync);
      setSelected(new Set((data.rows || []).filter((r) => r.status === "new").map((r) => r.row_number)));
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || "Fetch failed");
    } finally { setFetching(false); }
  };

  const selectableStatuses = useMemo(
    () => (includeExisting ? ["new", "duplicate_crm"] : ["new"]),
    [includeExisting]
  );
  const isSelectable = (r) => selectableStatuses.includes(r.status);

  const visibleRows = useMemo(() => {
    return rows.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(`${r.name} ${r.phone} ${r.email} ${r.course} ${r.place}`.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [rows, filter, search]);

  const toggleRow = (r) => {
    if (!isSelectable(r)) return;
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(r.row_number)) n.delete(r.row_number); else n.add(r.row_number);
      return n;
    });
  };
  const selectableVisible = visibleRows.filter(isSelectable);
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every((r) => selected.has(r.row_number));
  const toggleAll = () => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (allVisibleSelected) selectableVisible.forEach((r) => n.delete(r.row_number));
      else selectableVisible.forEach((r) => n.add(r.row_number));
      return n;
    });
  };

  const doImport = async () => {
    if (selected.size === 0) { toast.error("Select at least one lead"); return; }
    setImporting(true);
    try {
      if (enableSync) {
        await api.post("/google/config", {
          campaign_id: campaignId, spreadsheet_id: ssId,
          spreadsheet_name: spreadsheets.find((s) => s.id === ssId)?.name, worksheet_title: wsTitle, sync_enabled: true,
        });
      }
      const { data } = await api.post("/google/import", {
        spreadsheet_id: ssId, spreadsheet_name: spreadsheets.find((s) => s.id === ssId)?.name,
        worksheet_title: wsTitle, campaign_id: campaignId,
        row_numbers: Array.from(selected), include_existing: includeExisting,
      });
      toast.success(`Imported ${data.imported} new · ${data.existing} existing · ${data.duplicates} dup · ${data.invalid} invalid`);
      onImported?.();
      loadHistory();
      reset();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || "Import failed");
    } finally { setImporting(false); }
  };

  const validCount = counts?.new || 0;
  const selectedCount = selected.size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" data-testid="gs-import-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <GoogleLogo size={18} weight="bold" className="text-emerald-600 dark:text-emerald-400" /> Import from Google Sheets
          </DialogTitle>
          <DialogDescription>Fetch leads from a Google Sheet into <strong>{campaignName}</strong>. Review before importing.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
        ) : !status?.connected ? (
          <div className="py-8 text-center space-y-2" data-testid="gs-import-not-connected">
            <WarningCircle size={28} className="mx-auto text-amber-500" weight="duotone" />
            <p className="text-sm text-foreground">No Google account connected.</p>
            <p className="text-xs text-muted-foreground">Connect one in Settings → Integrations → Google Sheets, then come back.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Source selectors */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Google account</label>
                <div className="h-9 flex items-center px-3 rounded-md border border-border bg-muted/40 text-sm truncate" data-testid="gs-import-account">{status.account_email || "Connected"}</div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Spreadsheet</label>
                <Select value={ssId} onValueChange={pickSpreadsheet}>
                  <SelectTrigger data-testid="gs-import-spreadsheet"><SelectValue placeholder="Select spreadsheet" /></SelectTrigger>
                  <SelectContent>
                    {spreadsheets.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    {spreadsheets.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No spreadsheets found</div>}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Sheet / worksheet</label>
                <Select value={wsTitle} onValueChange={setWsTitle} disabled={!ssId}>
                  <SelectTrigger data-testid="gs-import-worksheet"><SelectValue placeholder="Select worksheet" /></SelectTrigger>
                  <SelectContent>
                    {worksheets.map((w) => <SelectItem key={w.id} value={w.title}>{w.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button onClick={fetchLeads} disabled={fetching || !wsTitle} className="btn-amber border-0 w-full" data-testid="gs-import-fetch-btn">
                  <ArrowClockwise size={15} className={`mr-1.5 ${fetching ? "animate-spin" : ""}`} /> {fetching ? "Fetching…" : "Fetch new leads"}
                </Button>
              </div>
            </div>

            {lastSync && (
              <p className="text-[11px] text-muted-foreground" data-testid="gs-import-lastsync">
                Last fetch: {new Date(lastSync).toLocaleString()} · New leads found: <strong className="text-foreground">{validCount}</strong>
              </p>
            )}

            {/* Preview */}
            {counts && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={allVisibleSelected} onCheckedChange={toggleAll} data-testid="gs-select-all" /> Select all
                  </label>
                  <div className="relative flex-1 min-w-[160px]">
                    <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name/phone/email" className="h-8 pl-8 text-sm" data-testid="gs-search" />
                  </div>
                  <Select value={filter} onValueChange={setFilter}>
                    <SelectTrigger className="h-8 w-[150px] text-sm" data-testid="gs-filter"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All rows</SelectItem>
                      <SelectItem value="new">New only</SelectItem>
                      <SelectItem value="duplicate_crm">In CRM</SelectItem>
                      <SelectItem value="duplicate_campaign">In campaign</SelectItem>
                      <SelectItem value="invalid_phone">Invalid phone</SelectItem>
                      <SelectItem value="invalid_email">Invalid email</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="max-h-[38vh] overflow-y-auto">
                    <table className="w-full text-sm" data-testid="gs-preview-table">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                          <th className="p-2 w-8"></th>
                          <th className="p-2">Name</th><th className="p-2">Phone</th><th className="p-2 hidden sm:table-cell">Course</th>
                          <th className="p-2 hidden md:table-cell">Place</th><th className="p-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRows.map((r) => {
                          const meta = STATUS_META[r.status] || STATUS_META.invalid;
                          return (
                            <tr key={r.row_number} className="border-t border-border hover:bg-muted/30" data-testid={`gs-row-${r.row_number}`}>
                              <td className="p-2">
                                <Checkbox checked={selected.has(r.row_number)} disabled={!isSelectable(r)} onCheckedChange={() => toggleRow(r)} data-testid={`gs-row-check-${r.row_number}`} />
                              </td>
                              <td className="p-2 font-medium text-foreground">{r.name || "—"}</td>
                              <td className="p-2 tabular-nums">{r.phone || "—"}</td>
                              <td className="p-2 hidden sm:table-cell text-muted-foreground">{r.course || "—"}</td>
                              <td className="p-2 hidden md:table-cell text-muted-foreground">{r.place || "—"}</td>
                              <td className="p-2"><span className={`text-[10px] px-2 py-0.5 rounded-full ${meta.cls}`} title={r.reason}>{meta.label}</span></td>
                            </tr>
                          );
                        })}
                        {visibleRows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground text-sm">No rows match.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <span className="text-emerald-600 dark:text-emerald-400"><strong>{counts.new}</strong> valid</span>
                  <span className="text-amber-600 dark:text-amber-400"><strong>{counts.duplicate}</strong> duplicate</span>
                  <span className="text-rose-600 dark:text-rose-400"><strong>{counts.invalid}</strong> invalid</span>
                  <label className="flex items-center gap-2 text-xs cursor-pointer ml-auto">
                    <Checkbox checked={includeExisting} onCheckedChange={(v) => setIncludeExisting(!!v)} data-testid="gs-include-existing" />
                    Also add existing CRM leads to this campaign
                  </label>
                </div>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <Checkbox checked={enableSync} onCheckedChange={(v) => setEnableSync(!!v)} data-testid="gs-enable-sync" />
                  Enable automatic Google Sheet sync for this campaign (Sync Now from the campaign)
                </label>
              </>
            )}

            {/* Import history */}
            {history.length > 0 && (
              <div className="pt-2 border-t border-border" data-testid="gs-import-history">
                <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5"><ClockCounterClockwise size={13} /> Import history</p>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {history.map((h) => (
                    <div key={h.id} className="text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 border border-border/60 rounded-md px-2.5 py-1.5">
                      <span className="text-foreground">{new Date(h.created_at).toLocaleString()}</span>
                      <span>Fetched {h.fetched}</span>
                      <span className="text-emerald-600 dark:text-emerald-400">Imported {h.imported}</span>
                      <span>Existing {h.existing}</span>
                      <span>Dup {h.duplicates}</span>
                      <span className="text-rose-600 dark:text-rose-400">Invalid {h.invalid}</span>
                      <span className="ml-auto">{h.source === "auto_sync" ? "Auto" : "Manual"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {status?.connected && counts && (
            <Button onClick={doImport} disabled={importing || selectedCount === 0} className="btn-amber border-0" data-testid="gs-import-confirm-btn">
              <CheckCircle size={15} className="mr-1.5" /> {importing ? "Importing…" : `Import ${selectedCount} lead${selectedCount === 1 ? "" : "s"}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
