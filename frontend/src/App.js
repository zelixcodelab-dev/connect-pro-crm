import React, { useEffect } from "react";
import "@/index.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import { BrandingProvider, useBranding } from "@/lib/branding";
import { Toaster } from "@/components/ui/sonner";

import AuthPage from "@/pages/AuthPage";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import AppShell from "@/pages/AppShell";
import Dashboard from "@/pages/Dashboard";
import Clients from "@/pages/Clients";
import ClientDetail from "@/pages/ClientDetail";
import Settings from "@/pages/Settings";
import Users from "@/pages/Users";
import Leads from "@/pages/Leads";
import Campaign from "@/pages/Campaign";
import Messages from "@/pages/Messages";
import Activity from "@/pages/Activity";
import Branding from "@/pages/Branding";
import PlatformConsole from "@/pages/PlatformConsole";
import PermGate from "@/components/PermGate";
import { PipelineProvider } from "@/lib/pipeline";

// Keeps the live theme in sync with the signed-in company. On logout it
// falls back to the public default branding.
function BrandingSync() {
  const { user } = useAuth();
  const { setBrandingData, resetBranding } = useBranding();
  useEffect(() => {
    if (user && user !== false) {
      if (user.branding) setBrandingData(user.branding, user.enabled_modules);
    } else if (user === false) {
      resetBranding();
    }
  }, [user, setBrandingData, resetBranding]);
  return null;
}

function Protected({ children }) {
  const { user } = useAuth();
  if (user === null) {
    return (
      <div className="h-screen w-full flex items-center justify-center text-muted-foreground" data-testid="auth-loading">
        <div className="animate-pulse text-sm tracking-widest uppercase">Loading…</div>
      </div>
    );
  }
  if (user === false) return <Navigate to="/login" replace />;
  // Platform owner belongs in the console, not the tenant app.
  if (user.scope === "platform") return <Navigate to="/platform" replace />;
  return children;
}

function PlatformProtected({ children }) {
  const { user } = useAuth();
  if (user === null) {
    return (
      <div className="h-screen w-full flex items-center justify-center text-muted-foreground">
        <div className="animate-pulse text-sm tracking-widest uppercase">Loading…</div>
      </div>
    );
  }
  if (user === false) return <Navigate to="/login" replace />;
  if (user.scope !== "platform") return <Navigate to="/" replace />;
  return children;
}

function PublicOnly({ children }) {
  const { user } = useAuth();
  if (user === null) return null;
  if (user) return <Navigate to="/" replace />;
  return children;
}

// Module-level constants so the `roles` prop on PermGate doesn't allocate a
// fresh array each render — keeps PermGate / its children stable.
const SUPER_ADMIN_ONLY = Object.freeze(["super_admin"]);
const LEADS_ROLES = Object.freeze(["super_admin", "office_admin", "staff"]);
const ADMIN_ROLES = Object.freeze(["super_admin", "office_admin"]);

export default function App() {
  return (
    <ThemeProvider>
      <BrandingProvider>
      <AuthProvider>
        <BrandingSync />
        <BrowserRouter>
        <Routes>
          <Route path="/login" element={<PublicOnly><AuthPage mode="login" /></PublicOnly>} />
          <Route path="/register" element={<PublicOnly><AuthPage mode="register" /></PublicOnly>} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/platform" element={<PlatformProtected><PlatformConsole /></PlatformProtected>} />
          <Route element={<Protected><PipelineProvider><AppShell /></PipelineProvider></Protected>}>
            <Route path="/" element={<PermGate page="overview"><Dashboard /></PermGate>} />
            <Route path="/leads" element={<PermGate roles={LEADS_ROLES} page="leads"><Leads /></PermGate>} />
            <Route path="/campaign" element={<PermGate roles={ADMIN_ROLES} page="leads"><Campaign /></PermGate>} />
            <Route path="/clients" element={<PermGate page="clients"><Clients pageScope="employees" /></PermGate>} />
            <Route path="/clients/:id" element={<PermGate page="clients"><ClientDetail /></PermGate>} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/messages/:id" element={<Messages />} />
            <Route path="/branding" element={<PermGate roles={SUPER_ADMIN_ONLY}><Branding /></PermGate>} />
            <Route path="/settings" element={<PermGate page="settings"><Settings /></PermGate>} />
            <Route path="/users" element={<PermGate roles={SUPER_ADMIN_ONLY}><Users /></PermGate>} />
            <Route path="/activity" element={<PermGate roles={ADMIN_ROLES}><Activity /></PermGate>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </BrowserRouter>
        <Toaster position="top-right" richColors />
      </AuthProvider>
      </BrandingProvider>
    </ThemeProvider>
  );
}
