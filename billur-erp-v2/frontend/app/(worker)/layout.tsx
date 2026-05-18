"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth/auth-context";
import { ADMIN_ROLES } from "@/lib/auth/roles";
import { Loader2, UserCircle, Wallet, Factory, Clock, LogOut, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WORKER_NAV = [
  { title: "Bosh sahifa", href: "/worker", icon: UserCircle },
  { title: "Ishlab chiqarish", href: "/worker/scan", icon: Factory },
  { title: "Davomat", href: "/worker/attendance", icon: Clock },
  { title: "Mening oyligim", href: "/worker/payroll", icon: Wallet },
  { title: "Hujjatlarim", href: "/worker/documents", icon: UserCircle },
];

export default function WorkerLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, logout, hasPermission } = useAuth();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
    if (!loading && user && ADMIN_ROLES.has(user.role_id) && user.role_id !== "boxing") {
      router.replace("/");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const showBoxui = user.role_id === "boxing" || hasPermission("boxapp.orders.read");

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-primary" />
          <span className="font-semibold text-sm">BILLUR — Ishchi portali</span>
        </div>
        <div className="flex items-center gap-2">
          {showBoxui && (
            <Button variant="outline" size="sm" asChild>
              <Link href="/boxui">BoxUI</Link>
            </Button>
          )}
          <span className="text-xs text-muted-foreground hidden sm:inline">{user.full_name}</span>
          <Button variant="ghost" size="icon" onClick={async () => { await logout(); router.push("/login"); }}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <nav className="border-b overflow-x-auto">
        <div className="flex gap-1 px-2 py-1 max-w-lg mx-auto">
          {WORKER_NAV.map(item => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg text-[10px] min-w-[64px]",
                  active ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.title}
              </Link>
            );
          })}
        </div>
      </nav>

      <main className="flex-1 p-4 max-w-lg mx-auto w-full">{children}</main>
    </div>
  );
}
