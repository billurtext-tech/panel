"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api/client";
import { getErrorMessage, logApiError } from "@/lib/api/errors";
import { useStages } from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const POSITIONS = [
  { id: "cutting", label: "Kesish" },
  { id: "printing", label: "Bosma" },
  { id: "sewing", label: "Tikuv" },
  { id: "quality", label: "Sifat" },
  { id: "ironing", label: "Dazmol" },
  { id: "packing", label: "Qadoqlash" },
  { id: "boxing", label: "Quti" },
  { id: "warehouse", label: "Ombor" },
  { id: "other", label: "Boshqa" },
] as const;

export function AddWorkerDialog() {
  const qc = useQueryClient();
  const { data: stages = [] } = useStages();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    employee_code: "",
    full_name: "",
    phone: "",
    position: "sewing" as string,
    default_stage: "",
    hire_date: "",
  });

  const reset = () => {
    setForm({
      employee_code: "",
      full_name: "",
      phone: "",
      position: "sewing",
      default_stage: "",
      hire_date: "",
    });
  };

  const mut = useMutation({
    mutationFn: () => {
      if (!form.employee_code.trim() || !form.full_name.trim()) {
        throw new Error("Tabel raqami va F.I.O. majburiy");
      }
      return api.post("/api/workers", {
        employee_code: form.employee_code.trim(),
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || null,
        position: form.position,
        default_stage: form.default_stage || null,
        hire_date: form.hire_date || null,
      });
    },
    onSuccess: () => {
      toast.success("Ishchi qo'shildi");
      qc.invalidateQueries({ queryKey: ["workers"] });
      reset();
      setOpen(false);
    },
    onError: (err) => {
      logApiError("workers.create", err);
      toast.error(getErrorMessage(err));
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> Ishchi qo&apos;shish
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Yangi ishchi</DialogTitle>
          <DialogDescription>
            Ma&apos;lumotlar backend modeliga mos yuboriladi (tabel, F.I.O., lavozim).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Tabel raqami *</Label>
            <Input
              placeholder="W-001"
              value={form.employee_code}
              onChange={(e) => setForm({ ...form, employee_code: e.target.value })}
              className="font-mono"
            />
          </div>
          <div>
            <Label>F.I.O. *</Label>
            <Input
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </div>
          <div>
            <Label>Telefon</Label>
            <Input
              placeholder="+998 90 123 4567"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div>
            <Label>Lavozim *</Label>
            <Select value={form.position} onValueChange={(v) => setForm({ ...form, position: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POSITIONS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Ishlab chiqarish bosqichi</Label>
            <Select
              value={form.default_stage || "_none"}
              onValueChange={(v) => setForm({ ...form, default_stage: v === "_none" ? "" : v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Tanlang" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">—</SelectItem>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name_uz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Ishga qabul sanasi</Label>
            <Input
              type="date"
              value={form.hire_date}
              onChange={(e) => setForm({ ...form, hire_date: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Bekor
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
