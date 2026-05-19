"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api/client";
import { getErrorMessage, logApiError } from "@/lib/api/errors";
import { useClients } from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus } from "lucide-react";

const PRIORITY_MAP: Record<string, number> = {
  urgent: 5,
  high: 3,
  medium: 1,
  low: 0,
};

export function CreateOrderDialog() {
  const qc = useQueryClient();
  const { data: clients = [], isLoading: clientsLoading, refetch } = useClients();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    order_type: "standard",
    client_id: "",
    external_code: "",
    deadline: "",
    priority: "medium",
    notes: "",
  });

  const reset = () => {
    setForm({
      order_type: "standard",
      client_id: "",
      external_code: "",
      deadline: "",
      priority: "medium",
      notes: "",
    });
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) refetch();
    if (!next) reset();
  };

  const mut = useMutation({
    mutationFn: () => {
      if (!form.client_id) throw new Error("Klientni tanlang");
      return api.post("/api/orders", {
        order_type: form.order_type,
        client_id: form.client_id,
        external_code: form.external_code.trim() || null,
        deadline: form.deadline || null,
        notes: form.notes.trim() || null,
        priority: PRIORITY_MAP[form.priority] ?? 0,
        items: [],
      });
    },
    onSuccess: () => {
      toast.success("Zakaz yaratildi");
      qc.invalidateQueries({ queryKey: ["orders"] });
      reset();
      setOpen(false);
    },
    onError: (err) => {
      logApiError("orders.create", err);
      toast.error(getErrorMessage(err));
    },
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> Yangi zakaz
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Yangi zakaz</DialogTitle>
          <DialogDescription>
            Faqat bazadagi haqiqiy klientlar ko&apos;rsatiladi. Avval klient qo&apos;shing, keyin zakaz yarating.
          </DialogDescription>
        </DialogHeader>

        {!clientsLoading && clients.length === 0 && (
          <Alert>
            <AlertDescription>
              Klient yo&apos;q.{" "}
              <Link href="/dashboard/clients" className="underline font-medium" onClick={() => setOpen(false)}>
                Klientlar
              </Link>{" "}
              bo&apos;limida yangi mijoz qo&apos;shing.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Zakaz turi *</Label>
              <Select value={form.order_type} onValueChange={(v) => setForm({ ...form, order_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="set">SET</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Klient *</Label>
              <Select
                value={form.client_id}
                onValueChange={(v) => setForm({ ...form, client_id: v })}
                disabled={clientsLoading || clients.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={clientsLoading ? "Yuklanmoqda…" : clients.length ? "Tanlang" : "Klient yo'q"} />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c: { id: string; name: string; code?: string }) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}{c.code ? ` (${c.code})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Tashqi kod</Label>
            <Input
              placeholder="ORD-2024-001"
              value={form.external_code}
              onChange={(e) => setForm({ ...form, external_code: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Muddat</Label>
              <Input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
            </div>
            <div>
              <Label>Ustuvorlik</Label>
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="urgent">Shoshilinch</SelectItem>
                  <SelectItem value="high">Yuqori</SelectItem>
                  <SelectItem value="medium">O&apos;rta</SelectItem>
                  <SelectItem value="low">Past</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Izoh</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Bekor</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || clientsLoading || !clients.length}>
            {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Yaratish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

