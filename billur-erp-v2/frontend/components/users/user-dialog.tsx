"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { getErrorMessage, logApiError } from "@/lib/api/errors";
import { roleNeedsWorkerLink } from "@/lib/auth/roles";
import { useStages } from "@/lib/api/hooks";
import { toast } from "sonner";
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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";

const POSITIONS = [
  "cutting", "printing", "sewing", "quality", "ironing", "packing", "boxing", "warehouse", "other",
];

export function UserDialog({
  user,
  roles,
  onClose,
  onSaved,
}: {
  user?: { id: string; username: string; full_name: string; role_id: string; is_active?: boolean; worker_code?: string };
  roles: { id: string; name_uz?: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!user;
  const { data: stages = [] } = useStages();

  const [form, setForm] = useState({
    username: user?.username || "",
    full_name: user?.full_name || "",
    role_id: user?.role_id || roles[0]?.id || "admin",
    password: "",
    is_active: user?.is_active ?? true,
    link_mode: "new" as "new" | "existing",
    worker_id: "",
    employee_code: user?.worker_code || user?.username || "",
    position:
      user?.role_id === "boxing"
        ? "boxing"
        : ["cutting", "printing", "sewing", "quality", "ironing", "packing"].includes(user?.role_id || "")
          ? user!.role_id
          : "sewing",
    default_stage: "",
  });

  const workerRequired = roleNeedsWorkerLink(form.role_id);

  const { data: unlinkedWorkers = [] } = useQuery({
    queryKey: ["workers", "unlinked"],
    queryFn: () => api.get("/api/workers?unlinked=true"),
    enabled: workerRequired,
  });

  const mut = useMutation({
    mutationFn: async () => {
      const workerPayload = workerRequired
        ? {
            worker_id:
              form.link_mode === "existing" && form.worker_id ? form.worker_id : undefined,
            employee_code: form.link_mode === "new" ? form.employee_code.trim() : undefined,
            position: form.position,
            default_stage: form.default_stage || null,
          }
        : {};

      if (isEdit) {
        await api.put(`/api/users/${user!.id}`, {
          full_name: form.full_name,
          role_id: form.role_id,
          is_active: form.is_active,
          ...workerPayload,
        });
        if (form.password) {
          await api.put(`/api/users/${user!.id}/password`, { password: form.password });
        }
        return;
      }
      if (!form.password || form.password.length < 6) {
        throw new Error("Parol kamida 6 belgi bo'lishi kerak");
      }
      if (workerRequired && form.link_mode === "new" && !form.employee_code.trim()) {
        throw new Error("Ishchi uchun tabel raqami kiriting");
      }
      if (workerRequired && form.link_mode === "existing" && !form.worker_id) {
        throw new Error("Mavjud ishchini tanlang");
      }
      return api.post("/api/users", {
        username: form.username,
        full_name: form.full_name,
        role_id: form.role_id,
        password: form.password,
        ...workerPayload,
      });
    },
    onSuccess: () => {
      toast.success(isEdit ? "Saqlandi" : "Qo'shildi");
      onSaved();
      onClose();
    },
    onError: (e) => {
      logApiError("users.save", e);
      toast.error(getErrorMessage(e));
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Foydalanuvchi tahrirlash" : "Yangi foydalanuvchi"}</DialogTitle>
          <DialogDescription>Login, rol va kerak bo&apos;lsa ishchi biriktirish</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Username *</Label>
            <Input
              value={form.username}
              disabled={isEdit}
              onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })}
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
            <Label>Rol *</Label>
            <Select
              value={form.role_id}
              onValueChange={(v) =>
                setForm({
                  ...form,
                  role_id: v,
                  position:
                    v === "boxing"
                      ? "boxing"
                      : POSITIONS.includes(v)
                        ? v
                        : form.position,
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name_uz || r.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {workerRequired && (
            <div className="rounded-lg border p-3 space-y-3 bg-muted/30">
              <p className="text-sm font-medium">Ishchi biriktirish *</p>
              <Select
                value={form.link_mode}
                onValueChange={(v: "new" | "existing") => setForm({ ...form, link_mode: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Yangi ishchi kartasi</SelectItem>
                  <SelectItem value="existing">Mavjud ishchini biriktirish</SelectItem>
                </SelectContent>
              </Select>
              {form.link_mode === "existing" ? (
                <div>
                  <Label>Ishchi</Label>
                  <Select
                    value={form.worker_id}
                    onValueChange={(v) => setForm({ ...form, worker_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Tanlang" />
                    </SelectTrigger>
                    <SelectContent>
                      {unlinkedWorkers.map((w: { id: string; employee_code: string; full_name: string }) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.employee_code} — {w.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <>
                  <div>
                    <Label>Tabel raqami *</Label>
                    <Input
                      className="font-mono"
                      value={form.employee_code}
                      onChange={(e) => setForm({ ...form, employee_code: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Lavozim</Label>
                    <Select
                      value={form.position}
                      onValueChange={(v) => setForm({ ...form, position: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {POSITIONS.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Bosqich (ixtiyoriy)</Label>
                    <Select
                      value={form.default_stage || "_none"}
                      onValueChange={(v) =>
                        setForm({ ...form, default_stage: v === "_none" ? "" : v })
                      }
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
                </>
              )}
            </div>
          )}

          <div>
            <Label>{isEdit ? "Yangi parol (ixtiyoriy)" : "Parol *"}</Label>
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={isEdit ? "Bo'sh qoldirsangiz o'zgarmaydi" : ""}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
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
