"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth/auth-context";
import { Loader2, Package, LogOut, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function BoxUILayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading, logout, hasPermission } = useAuth();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
    if (!loading && user && !hasPermission("boxapp.orders.read") && !hasPermission("box.scan") && user.role_id !== "owner" && user.role_id !== "admin") {
      router.replace("/worker");
    }
  }, [loading, user, router, hasPermission]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/95 px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-emerald-400" />
          <span className="font-bold">BoxUI</span>
          <span className="text-xs text-slate-400 hidden sm:inline">ERP zakazlari</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="text-slate-300" asChild>
            <Link href="/worker"><ArrowLeft className="h-4 w-4 mr-1" />Portal</Link>
          </Button>
          <Button variant="ghost" size="icon" className="text-slate-300" onClick={async () => { await logout(); router.push("/login"); }}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
