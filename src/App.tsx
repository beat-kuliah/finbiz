import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AppShell } from "@/components/AppShell";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { LoginPage, RegisterPage } from "@/pages/AuthPages";
import {
  AccountsPage,
  CapitalPage,
  CashPage,
  ContactsPage,
  JournalsPage,
  PayablesPage,
  ReceivablesPage,
  ReportsPage,
  TransactionsPage,
} from "@/pages/AppPages";
import { DashboardPage, OnboardingPage } from "@/pages/DashboardPages";
import { LandingPage } from "@/pages/LandingPage";

export default function App() {
  return (
    <BrowserRouter>
      <Toaster richColors position="top-center" />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/cash" element={<CashPage />} />
            <Route path="/capital" element={<CapitalPage />} />
            <Route path="/payables" element={<PayablesPage />} />
            <Route path="/receivables" element={<ReceivablesPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/journals" element={<JournalsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/contacts" element={<ContactsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
