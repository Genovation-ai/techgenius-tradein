import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./tokens.css";
import "./appGlobal.css";
import App from "./App.tsx";
import { AdminLayout } from "./admin/AdminLayout.tsx";
import { LoginPage } from "./admin/LoginPage.tsx";
import { SignupPage } from "./admin/SignupPage.tsx";
import { DashboardPage } from "./admin/pages/DashboardPage.tsx";
import { OffersPage } from "./admin/pages/OffersPage.tsx";
import { LeadsPage } from "./admin/pages/LeadsPage.tsx";
import { CatalogPage } from "./admin/pages/CatalogPage.tsx";
import { PricingPage } from "./admin/pages/PricingPage.tsx";
import { CustomersPage } from "./admin/pages/CustomersPage.tsx";
import { InventoryPage } from "./admin/pages/InventoryPage.tsx";
import { ReportsPage } from "./admin/pages/ReportsPage.tsx";
import { SettingsPage } from "./admin/pages/SettingsPage.tsx";
import { ShippingPage } from "./admin/pages/ShippingPage.tsx";
import { OfferDetailPage } from "./admin/pages/OfferDetailPage.tsx";
import { TeamPage } from "./admin/pages/TeamPage.tsx";
import { InvoicesPage } from "./admin/pages/InvoicesPage.tsx";
import { PayoutsPage } from "./admin/pages/PayoutsPage.tsx";
import { BulkHandoffPage } from "./admin/pages/BulkHandoffPage.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/admin/login" element={<LoginPage />} />
        <Route path="/admin/signup" element={<SignupPage />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="offers" element={<OffersPage />} />
          <Route path="leads" element={<LeadsPage />} />
          <Route path="offers/:id" element={<OfferDetailPage />} />
          <Route path="catalog" element={<CatalogPage />} />
          <Route path="pricing" element={<PricingPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="invoices" element={<InvoicesPage />} />
          <Route path="payouts" element={<PayoutsPage />} />
          <Route path="bulk" element={<BulkHandoffPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="shipping" element={<ShippingPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
