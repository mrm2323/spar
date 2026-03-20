"use client";

import { useState } from "react";
import AdminDashboard from "@/pages/AdminDashboard";
import AdminLogin from "@/pages/AdminLogin";

export default function AdminPage() {
  const [authed, setAuthed] = useState(
    typeof window !== "undefined" && sessionStorage.getItem("kabir_admin") === "true"
  );

  if (!authed) {
    return <AdminLogin onSuccess={() => setAuthed(true)} />;
  }

  return <AdminDashboard />;
}
