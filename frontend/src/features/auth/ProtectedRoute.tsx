import type { ReactNode } from "react";

import { Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useAuth } from "./AuthProvider";

type ProtectedRouteProps = {
  children: ReactNode;
};

export const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { t } = useTranslation();
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <main className="grid min-h-screen place-items-center bg-[var(--canvas)] text-sm text-[var(--muted)]">{t("auth.restoring")}</main>;
  }
  if (!isAuthenticated) {
    return <Navigate replace state={{ from: location.pathname }} to="/login" />;
  }
  return <>{children}</>;
};
