import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { GoogleLogo, CheckCircle, PlugsConnected, Plugs, FileArrowDown, ArrowSquareOut } from "@phosphor-icons/react";

export default function GoogleSheetsIntegration() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useSearchParams();

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/google/status");
      setStatus(data);
    } catch {
      setStatus({ configured: false, connected: false });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Handle the OAuth redirect result (?google=connected|error|scope).
  useEffect(() => {
    const g = params.get("google");
    if (!g) return;
    if (g === "connected") toast.success("Google account connected");
    else if (g === "scope") toast.error("Missing required Google permissions — please try again and allow Sheets access");
    else toast.error("Could not connect Google. Please try again.");
    const next = new URLSearchParams(params);
    next.delete("google");
    setParams(next, { replace: true });
    load();
  }, [params, setParams, load]);

  const connect = async () => {
    setBusy(true);
    try {
      const { data } = await api.get("/google/connect-url");
      window.location.href = data.url;
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || "Could not start Google connection");
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect this Google account? Automatic sync will stop.")) return;
    setBusy(true);
    try {
      await api.post("/google/disconnect");
      toast.success("Google account disconnected");
      load();
    } catch { toast.error("Failed to disconnect"); }
    finally { setBusy(false); }
  };

  const createTemplate = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/google/create-template");
      toast.success("Lead sheet created in your Google Drive", {
        action: { label: "Open", onClick: () => window.open(data.url, "_blank") },
      });
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || "Could not create sheet");
    } finally { setBusy(false); }
  };

  const connected = status?.connected;

  return (
    <Card className="p-6 border border-border bg-card rounded-lg shadow-none" data-testid="google-sheets-integration">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
          <GoogleLogo size={20} weight="bold" className="text-emerald-700 dark:text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-display text-lg sm:text-xl">Google Sheets</h2>
            {connected ? (
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100/60 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" data-testid="gs-status-connected">
                <CheckCircle size={11} weight="fill" /> Connected
              </span>
            ) : (
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground" data-testid="gs-status-disconnected">Not connected</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Import leads into your campaigns directly from a Google Sheet — no CSV exports.</p>

          {status && !status.configured && (
            <div className="mt-3 text-xs rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-foreground" data-testid="gs-not-configured">
              Google Sheets isn't configured on the server yet. Ask your administrator to add the Google OAuth credentials.
            </div>
          )}

          {status?.configured && connected && (
            <div className="mt-3 text-sm" data-testid="gs-connected-account">
              <span className="text-muted-foreground">Connected account:</span>{" "}
              <span className="font-medium">{status.account_email || "Google account"}</span>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {status?.configured && !connected && (
              <Button onClick={connect} disabled={busy} className="btn-amber border-0" data-testid="gs-connect-btn">
                <PlugsConnected size={16} className="mr-1.5" /> {busy ? "Redirecting…" : "Connect Google"}
              </Button>
            )}
            {connected && (
              <>
                <Button variant="outline" onClick={createTemplate} disabled={busy} data-testid="gs-create-template-btn">
                  <FileArrowDown size={16} className="mr-1.5" /> Create lead sheet
                </Button>
                <Button variant="outline" onClick={connect} disabled={busy} data-testid="gs-reconnect-btn">
                  <ArrowSquareOut size={16} className="mr-1.5" /> Reconnect
                </Button>
                <Button variant="outline" onClick={disconnect} disabled={busy} className="text-rose-600 hover:text-rose-700 border-rose-500/30" data-testid="gs-disconnect-btn">
                  <Plugs size={16} className="mr-1.5" /> Disconnect
                </Button>
              </>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground mt-3">
            Required sheet columns (row 1 headers): <code className="text-foreground">name · phone · email · course · place · source · notes</code>
          </p>
        </div>
      </div>
    </Card>
  );
}
