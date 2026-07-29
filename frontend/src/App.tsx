import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/layout/AppShell";
import { LoginPage } from "./features/auth/LoginPage";
import { ProtectedRoute } from "./features/auth/ProtectedRoute";
import { useAuth } from "./features/auth/AuthProvider";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { CatalogPage } from "./features/catalog/CatalogPage";
import { InventoryPage } from "./features/inventory/InventoryPage";
import { PartnersPage } from "./features/partners/PartnersPage";
import { PurchasePage, SalesPage } from "./features/orders/OrdersPage";

const OverviewRoute = () => {
  const { user } = useAuth();
  return user ? <DashboardPage role={user.role} /> : null;
};

const CatalogRoute = () => {
  const { user } = useAuth();
  return user ? <CatalogPage role={user.role} /> : null;
};

const InventoryRoute = () => {
  const { user } = useAuth();
  return user ? <InventoryPage role={user.role} /> : null;
};

const PartnersRoute = () => {
  const { user } = useAuth();
  return user ? <PartnersPage role={user.role} /> : null;
};

const PurchasesRoute = () => {
  const { user } = useAuth();
  return user ? <PurchasePage role={user.role} /> : null;
};

const SalesRoute = () => {
  const { user } = useAuth();
  return user ? <SalesPage role={user.role} /> : null;
};

const Workspace = () => (
  <ProtectedRoute><AppShell /></ProtectedRoute>
);

export const App = () => (
  <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<Workspace />} path="/">
      <Route index element={<OverviewRoute />} />
      <Route path="catalog" element={<CatalogRoute />} />
      <Route path="inventory" element={<InventoryRoute />} />
      <Route path="purchases" element={<PurchasesRoute />} />
      <Route path="sales" element={<SalesRoute />} />
      <Route path="customers" element={<PartnersRoute />} />
      <Route path="suppliers" element={<Navigate replace to="/customers?tab=suppliers" />} />
    </Route>
    <Route path="*" element={<Navigate replace to="/" />} />
  </Routes>
);
