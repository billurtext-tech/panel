"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { QrScanner } from "@/components/qr/qr-scanner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function WorkerScanPage() {
  const [stage, setStage] = useState("sewing");
  const [lastResult, setLastResult] = useState<string | null>(null);

  const { data: worker } = useQuery({
    queryKey: ["my-worker"],
    queryFn: () => api.get<{ id: string; full_name: string; default_stage: string } | null>("/api/worker-profile/me"),
  });

  const { data: stages = [] } = useQuery({
    queryKey: ["stages"],
    queryFn: () => api.get<Array<{ id: string; name_uz: string }>>("/api/master/stages"),
  });

  useEffect(() => {
    if (worker?.default_stage) setStage(worker.default_stage);
  }, [worker]);

  const handleScan = async (code: string) => {
    if (!worker?.id) {
      toast.error("Ishchi profili bog'lanmagan");
      return;
    }
    try {
      const lookup = await api.get<{ current_stage: string; status: string }>(
        `/api/scanning/qr-codes/${encodeURIComponent(code)}`
      );
      const action = lookup.status === "in_progress" ? "FINISH" : "START";
      const res = await api.post<{ message?: string; next_stage: string | null }>("/api/scanning/scan", {
        qr_code: code,
        worker_id: worker.id,
        stage: lookup.current_stage || stage,
        action,
      });
      setLastResult(`${action} — ${code} → ${res.next_stage || "tugadi"}`);
      toast.success(`${action} muvaffaqiyatli`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Scan xato");
    }
  };

  if (!worker) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-muted-foreground text-sm">
          Ishchi profili bog'lanmagan. Administrator bilan bog'laning.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Production Scan</h1>
      <p className="text-sm text-muted-foreground">{worker.full_name}</p>

      <Select value={stage} onValueChange={setStage}>
        <SelectTrigger>
          <SelectValue placeholder="Bosqich" />
        </SelectTrigger>
        <SelectContent>
          {stages.filter(s => !["raw", "finished", "surplus"].includes(s.id)).map(s => (
            <SelectItem key={s.id} value={s.id}>{s.name_uz}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <QrScanner onScan={handleScan} />

      {lastResult && (
        <Badge className="w-full justify-center py-2">{lastResult}</Badge>
      )}
    </div>
  );
}
