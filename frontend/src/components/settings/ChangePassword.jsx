import React, { useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Key, Eye, EyeSlash, ShieldCheck } from "@phosphor-icons/react";

// Authenticated self-service "change password" card for the Settings page.
export default function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!current) return toast.error("Enter your current password");
    if (next.length < 8) return toast.error("New password must be at least 8 characters");
    if (next !== confirm) return toast.error("New passwords don't match");
    if (next === current) return toast.error("New password must be different");
    setSaving(true);
    try {
      await api.post("/auth/change-password", { current_password: current, new_password: next });
      toast.success("Password changed successfully");
      setCurrent(""); setNext(""); setConfirm("");
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Could not change password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6 border border-border bg-card rounded-lg shadow-none" data-testid="change-password-card">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
          <Key size={20} weight="fill" className="text-amber-700 dark:text-amber-400" />
        </div>
        <div>
          <p className="label-eyebrow flex items-center gap-1"><ShieldCheck size={11} weight="fill" /> Security</p>
          <h2 className="font-display text-lg sm:text-xl mt-0.5">Change password</h2>
          <p className="text-xs text-muted-foreground mt-1">Enter your current password, then choose a new one (min 8 characters).</p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label>Current password</Label>
          <Input type={show ? "text" : "password"} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" data-testid="cp-current" />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>New password</Label>
            <div className="relative">
              <Input type={show ? "text" : "password"} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" className="pr-10" data-testid="cp-new" />
              <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1" title={show ? "Hide" : "Show"} data-testid="cp-toggle">
                {show ? <EyeSlash size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Confirm new password</Label>
            <Input type={show ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" data-testid="cp-confirm" />
          </div>
        </div>
        <Button type="submit" disabled={saving} className="btn-amber border-0 lift" data-testid="cp-submit">
          {saving ? "Updating…" : "Update password"}
        </Button>
      </form>
    </Card>
  );
}
