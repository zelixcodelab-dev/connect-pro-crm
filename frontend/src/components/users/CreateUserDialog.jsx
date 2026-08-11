import React, { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { UserPlus, Eye, EyeSlash, ShieldCheck, CheckCircle } from "@phosphor-icons/react";

// Employee client-types that can be granted a login.
const EMPLOYEE_TYPES = ["staff", "km_blr_office", "km_tcr_office", "km_kmly_office"];

const emptyNewUser = () => ({
  email: "", password: "", name: "", role: "user", currency: "INR", linked_client_id: "",
});

/** Create-user dialog. You pick an existing Employee to give them a login;
 *  their name/email auto-fill and the role follows the employee's type
 *  (User → user, Admin → full company admin). You can override the role. */
export default function CreateUserDialog({ open, onOpenChange, onCreated }) {
  const [form, setForm] = useState(emptyNewUser);
  const [saving, setSaving] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [empLoaded, setEmpLoaded] = useState(false);
  const [empSearch, setEmpSearch] = useState("");

  useEffect(() => {
    if (open) { setForm(emptyNewUser()); setShowPwd(false); setEmpSearch(""); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/clients");
        if (cancelled) return;
        setEmployees((data || []).filter((c) => EMPLOYEE_TYPES.includes(c.client_type)));
        setEmpLoaded(true);
      } catch (err) {
        console.error("[users] failed to load employees:", err?.message || err);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const pickEmployee = (id) => {
    const emp = employees.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      linked_client_id: id,
      name: emp?.name || f.name,
      email: emp?.email || f.email,
      role: emp?.emp_type === "admin" ? "super_admin" : "user",
    }));
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (!form.linked_client_id) { toast.error("Pick an employee to give login access"); return; }
    if (!form.email.trim() || !form.password || !form.name.trim()) {
      toast.error("Employee, email and password are required"); return;
    }
    if (form.password.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    setSaving(true);
    try {
      const payload = {
        email: form.email.trim().toLowerCase(),
        password: form.password,
        name: form.name.trim(),
        role: form.role,
        currency: form.currency || "INR",
        linked_client_id: form.linked_client_id,
      };
      const { data } = await api.post("/users", payload);
      toast.success(`${data.name} created · can sign in immediately`);
      onOpenChange(false);
      onCreated?.(data);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Create failed");
    } finally {
      setSaving(false);
    }
  };

  const isAdmin = form.role === "super_admin";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="create-user-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <UserPlus size={18} weight="duotone" className="text-orange-600 dark:text-orange-400" />
            Create user
          </DialogTitle>
          <DialogDescription>
            Give an employee login access — pick them below, set a password, and choose their access level.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Employee <span className="text-rose-600">*</span></Label>
            <Select value={form.linked_client_id || ""} onValueChange={pickEmployee}>
              <SelectTrigger data-testid="cu-linked-client" className="w-full">
                <SelectValue placeholder={empLoaded ? "Select an employee…" : "Loading employees…"} />
              </SelectTrigger>
              <SelectContent>
                <div className="px-2 pt-1 pb-2">
                  <Input
                    value={empSearch}
                    onChange={(e) => setEmpSearch(e.target.value)}
                    placeholder="Search employees by name"
                    className="h-8 text-sm"
                    data-testid="cu-linked-client-search"
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </div>
                {employees
                  .filter((c) => !empSearch || c.name.toLowerCase().includes(empSearch.toLowerCase()))
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id} data-testid={`cu-linked-client-opt-${c.id}`}>
                      <div className="flex flex-col">
                        <span>{c.name}</span>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {c.emp_type === "admin" ? "Admin" : "Employee"}{c.email ? ` · ${c.email}` : ""}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                {empLoaded && employees.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    No employees yet. Add one from the Employees page first.
                  </div>
                )}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">
              Their name and email fill in automatically — just set a password and confirm the role.
            </p>
          </div>

          <div>
            <Label>Full name <span className="text-rose-600">*</span></Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Doe" data-testid="cu-name" required />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Email <span className="text-rose-600">*</span></Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="user@company.com" data-testid="cu-email" required />
            </div>
            <div>
              <Label>Password <span className="text-rose-600">*</span></Label>
              <div className="relative">
                <Input type={showPwd ? "text" : "password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Min 6 characters" data-testid="cu-password" required className="pr-10" />
                <button type="button" onClick={() => setShowPwd((v) => !v)} data-testid="cu-toggle-pwd" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1" title={showPwd ? "Hide password" : "Show password"}>
                  {showPwd ? <EyeSlash size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Share this password with the user securely.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Role <span className="text-rose-600">*</span></Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger data-testid="cu-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="super_admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Currency</Label>
              <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                <SelectTrigger data-testid="cu-currency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="INR">INR (₹)</SelectItem>
                  <SelectItem value="USD">USD ($)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {isAdmin ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-gradient-soft p-3 text-xs flex items-start gap-2.5" data-testid="cu-super-warning">
              <ShieldCheck size={16} weight="fill" className="text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
              <span className="text-foreground">
                <strong>Admin</strong> gets full access to every page and can manage other users. Use sparingly.
              </span>
            </div>
          ) : (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/10 p-3 text-xs flex items-start gap-2.5">
              <CheckCircle size={16} weight="fill" className="text-emerald-700 dark:text-emerald-400 mt-0.5 shrink-0" />
              <span className="text-foreground">
                <strong>User</strong> gets a standard login tied to this employee. Fine-tune access via the Permissions button after creation.
              </span>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving} className="btn-amber border-0" data-testid="cu-save">
              <UserPlus size={14} className="mr-1.5" />
              {saving ? "Creating…" : "Create user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
