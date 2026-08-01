import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AppShell } from "@/components/AppShell";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { LoginPage, RegisterPage } from "@/pages/AuthPages";
import {
  AccountsPage,
  AssetsPage,
  BillingPage,
  CapitalPage,
  CashPage,
  ContactDetailPage,
  ContactsPage,
  InvoicePrintPage,
  JournalsPage,
  PayablesPage,
  ReceivablesPage,
  ReportsPage,
  TransactionsPage,
} from "@/pages/AppPages";
import { DashboardPage, OnboardingPage } from "@/pages/DashboardPages";
import { LandingPage } from "@/pages/LandingPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { useEffect } from "react";
import { usePreferences } from "@/store/preferences";

function PreferencesBoot({ children }: { children: React.ReactNode }) {
  const hydrate = usePreferences((s) => s.hydrate);
  useEffect(() => {
    hydrate();
  }, [hydrate]);
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <PreferencesBoot>
        <Toaster richColors position="top-center" />
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/invoices/:id/print" element={<InvoicePrintPage />} />
            <Route element={<AppShell />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/transactions" element={<TransactionsPage />} />
              <Route path="/cash" element={<CashPage />} />
              <Route path="/capital" element={<CapitalPage />} />
              <Route path="/payables" element={<PayablesPage />} />
              <Route path="/receivables" element={<ReceivablesPage />} />
              <Route path="/accounts" element={<AccountsPage />} />
              <Route path="/assets" element={<AssetsPage />} />
              <Route path="/journals" element={<JournalsPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/contacts" element={<ContactsPage />} />
              <Route path="/contacts/:id" element={<ContactDetailPage />} />
              <Route path="/billing" element={<BillingPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </PreferencesBoot>
    </BrowserRouter>
  );
}
