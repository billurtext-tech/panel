"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Factory, Calendar, TrendingUp } from "lucide-react";

interface WorkerStats {
  today: { qty: number; scans: number };
  week: { qty: number; scans: number };
  month: { qty: number; scans: number };
  models: Array<{ model_code: string; model_name: string; quantity: number }>;
  attendance: { is_checked_in: boolean; last_record: { record_type: string; recorded_at: string } | null };
}

export default function WorkerHomePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["worker-stats"],
    queryFn: () => api.get<WorkerStats>("/api/worker-profile/me/stats"),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const stats = data || {
    today: { qty: 0, scans: 0 },
    week: { qty: 0, scans: 0 },
    month: { qty: 0, scans: 0 },
    models: [],
    attendance: { is_checked_in: false, last_record: null },
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Salom!</h1>
        <p className="text-sm text-muted-foreground">Bugungi ishlab chiqarish statistikangiz</p>
      </div>

      <Card>
        <CardContent className="pt-4 flex items-center justify-between">
          <span className="text-sm">Davomat holati</span>
          <Badge variant={stats.attendance.is_checked_in ? "default" : "secondary"}>
            {stats.attendance.is_checked_in ? "Ishda" : "Kelmagan / Ketgan"}
          </Badge>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-2">
        <StatCard title="Bugun" icon={Factory} qty={stats.today.qty} scans={stats.today.scans} />
        <StatCard title="Hafta" icon={Calendar} qty={stats.week.qty} scans={stats.week.scans} />
        <StatCard title="Oy" icon={TrendingUp} qty={stats.month.qty} scans={stats.month.scans} />
      </div>

      {stats.models.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Ishlab chiqarilgan modellar (oy)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {stats.models.map(m => (
              <div key={m.model_code} className="flex justify-between text-sm">
                <span>{m.model_code} — {m.model_name}</span>
                <span className="font-medium">{m.quantity} dona</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({ title, icon: Icon, qty, scans }: {
  title: string; icon: React.ComponentType<{ className?: string }>;
  qty: number; scans: number;
}) {
  return (
    <Card>
      <CardContent className="pt-3 pb-3 text-center">
        <Icon className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
        <p className="text-[10px] text-muted-foreground">{title}</p>
        <p className="text-lg font-bold">{qty}</p>
        <p className="text-[10px] text-muted-foreground">{scans} scan</p>
      </CardContent>
    </Card>
  );
}
