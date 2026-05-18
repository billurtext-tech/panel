"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export default function WorkerPayrollPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["my-payroll"],
    queryFn: () => api.get<Array<{
      id: string; period_start: string; period_end: string;
      net_amount: number; status: string; total_quantity: number;
    }>>("/api/payroll/entries"),
  });

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Mening oyligim</h1>
      {!data?.length ? (
        <p className="text-sm text-muted-foreground text-center py-8">Hali ma'lumot yo'q</p>
      ) : (
        data.map(entry => (
          <Card key={entry.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                {entry.period_start} — {entry.period_end}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex justify-between">
              <span className="text-2xl font-bold">
                {Number(entry.net_amount).toLocaleString()} UZS
              </span>
              <span className="text-sm text-muted-foreground">{entry.total_quantity} dona</span>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
