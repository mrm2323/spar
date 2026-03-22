"use client";

import { useReducer, useSyncExternalStore } from "react";
import AdminDashboard from "@/pages/AdminDashboard";
import AdminLogin from "@/pages/AdminLogin";

function subscribeToAdminAuth(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};

  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener("focus", handler);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener("focus", handler);
  };
}

function getAdminAuthSnapshot() {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem("kabir_admin") === "true";
}

export default function AdminPage() {
  // Force a local re-render after successful same-tab login.
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const authed = useSyncExternalStore(
    subscribeToAdminAuth,
    getAdminAuthSnapshot,
    () => false
  );

  if (!authed) {
    return <AdminLogin onSuccess={() => bump()} />;
  }

  return <AdminDashboard />;
}
