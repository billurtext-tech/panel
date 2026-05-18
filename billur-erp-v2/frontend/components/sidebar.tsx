"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard, ShoppingCart, Factory, Users, Package,
  CheckCircle, QrCode, BarChart3, Scissors, Building2, LogOut,
  ScrollText, Truck, Printer, Gift, Menu, X, ChevronDown,
  UserCircle, Wallet, DollarSign, RefreshCw, Boxes,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/auth-context";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

interface NavItem {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  perm?: string;
  group: string;
}

/** Sidebar groups — ketma-ket tartibda ko'rsatiladi */
const GROUP_ORDER = [
  "Asosiy",
  "BoxApp",
  "Ishlab chiqarish",
  "Ombor",
  "Kadrlar",
  "Hisobot",
] as const;

const NAV: NavItem[] = [
  // —— Asosiy ——
  { title: "Dashboard",       icon: LayoutDashboard, href: "/dashboard",           perm: "orders.read", group: "Asosiy" },
  { title: "Klientlar",       icon: Building2,       href: "/dashboard/clients",     perm: "clients.read", group: "Asosiy" },
  { title: "Zakazlar",        icon: ShoppingCart,    href: "/dashboard/orders",      perm: "orders.read", group: "Asosiy" },

  // —— BoxApp (barchasi ketma-ket) ——
  { title: "BoxUI skaner",    icon: Package,         href: "/boxui",                 perm: "boxapp.orders.read", group: "BoxApp" },
  { title: "BoxApp",          icon: Boxes,           href: "/dashboard/boxes",       perm: "box.read", group: "BoxApp" },
  { title: "BoxApp Sync",     icon: RefreshCw,       href: "/dashboard/boxapp-sync", perm: "boxapp.view", group: "BoxApp" },
  { title: "Yuk tashish",     icon: Truck,           href: "/dashboard/shipments",   perm: "box.read", group: "BoxApp" },

  // —— Ishlab chiqarish ——
  { title: "Production Scan", icon: QrCode,          href: "/dashboard/production-scan", perm: "production.qr.scan", group: "Ishlab chiqarish" },
  { title: "QR kodlar",       icon: QrCode,          href: "/dashboard/qr-codes",        perm: "production.qr.create", group: "Ishlab chiqarish" },
  { title: "Traceability",    icon: ScrollText,      href: "/dashboard/trace",           perm: "production.trace.view", group: "Ishlab chiqarish" },
  { title: "Production",      icon: Factory,         href: "/dashboard/production",      perm: "production.read", group: "Ishlab chiqarish" },
  { title: "Sifat nazorati",  icon: CheckCircle,     href: "/dashboard/quality",       perm: "quality.read", group: "Ishlab chiqarish" },
  { title: "Ishchi skan",     icon: QrCode,          href: "/dashboard/scanning",      perm: "qr.scan", group: "Ishlab chiqarish" },
  { title: "Bosma",           icon: Printer,         href: "/dashboard/print",         perm: "print.read", group: "Ishlab chiqarish" },

  // —— Ombor ——
  { title: "Ombor",           icon: Package,         href: "/dashboard/inventory", perm: "inventory.read", group: "Ombor" },
  { title: "Izlishka",        icon: Gift,            href: "/dashboard/surplus",   perm: "surplus.read", group: "Ombor" },

  // —— Kadrlar ——
  { title: "Ishchilar",       icon: Users,           href: "/dashboard/workers",     perm: "workers.read", group: "Kadrlar" },
  { title: "Foydalanuvchilar",icon: Users,           href: "/dashboard/users",       perm: "users.read", group: "Kadrlar" },
  { title: "Payroll",         icon: Wallet,          href: "/dashboard/payroll",     perm: "payroll.view_all", group: "Kadrlar" },
  { title: "Mening oyligim",  icon: Wallet,          href: "/dashboard/my-payroll",  perm: "payroll.view_own", group: "Kadrlar" },
  { title: "Piece rates",     icon: DollarSign,      href: "/dashboard/piece-rates", perm: "piece_rates.read", group: "Kadrlar" },
  { title: "Mening profilim", icon: UserCircle,      href: "/dashboard/my-profile", group: "Kadrlar" },

  // —— Hisobot ——
  { title: "Hisobotlar",      icon: BarChart3,       href: "/dashboard/reports", perm: "reports.read", group: "Hisobot" },
  { title: "Audit",           icon: ScrollText,      href: "/dashboard/audit",   perm: "audit.read", group: "Hisobot" },
];

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, hasPermission } = useAuth();

  const isOwner = user?.role_id === "owner";
  const visible = NAV.filter((i) => !i.perm || isOwner || hasPermission(i.perm));

  const groups: Record<string, NavItem[]> = {};
  for (const item of visible) {
    if (!groups[item.group]) groups[item.group] = [];
    groups[item.group].push(item);
  }

  const initials = user?.full_name
    ? user.full_name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()
    : "??";

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 lg:hidden transition-opacity",
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />

      <aside
        className={cn(
          "fixed top-0 left-0 z-50 h-screen w-64 bg-sidebar border-r border-sidebar-border flex flex-col",
          "transition-transform duration-200 ease-in-out",
          "lg:translate-x-0 lg:static lg:z-auto",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4 shrink-0">
          <Link href="/dashboard" className="flex items-center gap-2" onClick={onClose}>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Scissors className="h-4 w-4" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="font-semibold text-sm text-sidebar-foreground">BILLUR ERP</span>
              <span className="text-[10px] text-muted-foreground">Production System</span>
            </div>
          </Link>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {GROUP_ORDER.map((groupName) => {
            const items = groups[groupName];
            if (!items?.length) return null;
            return (
              <div key={groupName} className="mb-4">
                <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-sidebar-border/50 mb-1">
                  {groupName}
                </div>
                <ul className="space-y-0.5">
                  {items.map((item) => {
                    const isActive =
                      pathname === item.href ||
                      (item.href !== "/dashboard" && pathname.startsWith(item.href));
                    const Icon = item.icon;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={onClose}
                          className={cn(
                            "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                            isActive
                              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                              : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="truncate">{item.title}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-2 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-full flex items-center gap-2 rounded-md p-2 hover:bg-sidebar-accent/50 transition-colors">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left text-xs">
                  <div className="font-semibold text-sidebar-foreground truncate">
                    {user?.full_name || "—"}
                  </div>
                  <div className="text-muted-foreground uppercase text-[10px]">
                    {user?.role_id || ""}
                  </div>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-xs">
                <div className="font-medium">{user?.username}</div>
                <div className="text-muted-foreground font-normal text-[11px]">
                  {user?.permissions?.length || 0} ta huquq
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={async () => {
                  await logout();
                  router.push("/login");
                }}
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span>Chiqish</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}

export function TopHeader({ onMenuClick }: { onMenuClick: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenuClick}>
        <Menu className="h-5 w-5" />
      </Button>
      <div className="font-semibold">BILLUR ERP</div>
    </header>
  );
}
