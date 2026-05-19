"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Loader2, Plus, Trash2, FileSpreadsheet } from "lucide-react";

/** Bolalar o'lchamlari (Laretto speka) */
const KID_SIZES = [
  "92", "98", "104", "110", "116", "122", "128", "134",
  "140", "146", "152", "158", "164", "170",
] as const;

const ADULT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;

type SpekaLine = {
  id: string;
  model_code: string;
  color_code: string;
  size_qty: Record<string, string>;
};

function newLine(): SpekaLine {
  return {
    id: Math.random().toString(36).slice(2),
    model_code: "",
    color_code: "",
    size_qty: Object.fromEntries(KID_SIZES.map((s) => [s, ""])),
  };
}

const PRIORITY_MAP: Record<string, number> = {
  urgent: 5,
  high: 3,
  medium: 1,
  low: 0,
};

export function CreateSpekaOrderDialog() {
  const qc = useQueryClient();
  const { data: clients = [], isLoading: clientsLoading, refetch } = useClients();
  const [open, setOpen] = useState(false);
  const [showAdultSizes, setShowAdultSizes] = useState(false);
  const [clientId, setClientId] = useState("");
  const [spekaNumber, setSpekaNumber] = useState("");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState("medium");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<SpekaLine[]>([newLine()]);

  const { data: models = [] } = useQuery<{ id: string; code: string; name: string }[]>({
    queryKey: ["models"],
    queryFn: () => api.get("/api/master/models"),
    enabled: open,
  });

  const { data: colors = [] } = useQuery<{ id: string; code: string; name_uz: string }[]>({
    queryKey: ["colors"],
    queryFn: () => api.get("/api/master/colors"),
    enabled: open,
  });

  const sizeColumns = showAdultSizes ? [...KID_SIZES, ...ADULT_SIZES] : [...KID_SIZES];

  const reset = () => {
    setClientId("");
    setSpekaNumber("");
    setDeadline("");
    setPriority("medium");
    setNotes("");
    setLines([newLine()]);
    setShowAdultSizes(false);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) refetch();
    if (!next) reset();
  };

  const updateLine = (id: string, patch: Partial<SpekaLine>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const setSizeQty = (lineId: string, size: string, value: string) => {
    setLines((prev) =>
      prev.map((l) =>
        l.id === lineId ? { ...l, size_qty: { ...l.size_qty, [size]: value } } : l
      )
    );
  };

  const buildPayload = () => {
    const items = lines
      .map((line) => {
        const model_code = line.model_code.trim();
        const color_code = line.color_code.trim();
        if (!model_code) return null;
        const size_breakdown: Record<string, number> = {};
        for (const sz of sizeColumns) {
          const q = parseInt(line.size_qty[sz] || "0", 10);
          if (q > 0) size_breakdown[sz] = q;
        }
        if (!Object.keys(size_breakdown).length) return null;
        if (!color_code) throw new Error(`Model ${model_code}: rangni kiriting (masalan BLACK)`);
        return { model_code, color_code, size_breakdown };
      })
      .filter(Boolean);

    if (!items.length) {
      throw new Error("Kamida bitta model, rang va miqdor kiriting");
    }
    return items;
  };

  const mut = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error("Klientni tanlang");
      const items = buildPayload();
      return api.post("/api/orders/speka", {
        client_id: clientId,
        speka_number: spekaNumber.trim() || undefined,
        deadline: deadline || null,
        priority: PRIORITY_MAP[priority] ?? 0,
        notes: notes.trim() || null,
        items,
      });
    },
    onSuccess: (order: { id?: string; external_code?: string }) => {
      toast.success(`Speka yaratildi: ${order?.external_code || ""}`);
      qc.invalidateQueries({ queryKey: ["orders"] });
      reset();
      setOpen(false);
    },
    onError: (err) => {
      logApiError("orders.speka.create", err);
      toast.error(getErrorMessage(err));
    },
  });

  const lineTotal = (line: SpekaLine) =>
    sizeColumns.reduce((s, sz) => s + (parseInt(line.size_qty[sz] || "0", 10) || 0), 0);

  const grandTotal = lines.reduce((s, l) => s + lineTotal(l), 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="default">
          <FileSpreadsheet className="mr-2 h-4 w-4" /> Speka zakaz
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Speka zakaz (Laretto va h.k.)</DialogTitle>
          <DialogDescription>
            Har bir qator — model + rang. Har bir o&apos;lcham uchun dona sonini kiriting (masalan 140: 100).
            Modellar va ranglar avval bazada bo&apos;lishi kerak.
          </DialogDescription>
        </DialogHeader>

        {!clientsLoading && clients.length === 0 && (
          <Alert>
            <AlertDescription>
              Klient yo&apos;q.{" "}
              <Link href="/dashboard/clients" className="underline font-medium" onClick={() => setOpen(false)}>
                Klientlar
              </Link>{" "}
              bo&apos;limida qo&apos;shing.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="col-span-2">
            <Label>Klient *</Label>
            <Select value={clientId} onValueChange={setClientId} disabled={clientsLoading}>
              <SelectTrigger>
                <SelectValue placeholder="Tanlang" />
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
          <div>
            <Label>Speka raqami</Label>
            <Input
              placeholder="52, 66, ..."
              value={spekaNumber}
              onChange={(e) => setSpekaNumber(e.target.value)}
              className="font-mono"
            />
          </div>
          <div>
            <Label>Muddat</Label>
            <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>Modellar: {models.length}</span>
          <span>Ranglar: {colors.length}</span>
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 text-xs"
            onClick={() => setShowAdultSizes((v) => !v)}
          >
            {showAdultSizes ? "Faqat bolalar o'lchamlari" : "+ Kattalar (XS–XXL)"}
          </Button>
        </div>

        <div className="space-y-4">
          {lines.map((line, idx) => (
            <div key={line.id} className="rounded-lg border p-3 space-y-3 bg-muted/20">
              <div className="flex items-end gap-2 flex-wrap">
                <div className="flex-1 min-w-[140px]">
                  <Label>Model * {idx + 1}</Label>
                  <Input
                    list={`models-list-${line.id}`}
                    placeholder="LRTT-084"
                    className="font-mono"
                    value={line.model_code}
                    onChange={(e) => updateLine(line.id, { model_code: e.target.value.toUpperCase() })}
                  />
                  <datalist id={`models-list-${line.id}`}>
                    {models.map((m) => (
                      <option key={m.id} value={m.code}>
                        {m.name}
                      </option>
                    ))}
                  </datalist>
                </div>
                <div className="flex-1 min-w-[120px]">
                  <Label>Rang *</Label>
                  <Input
                    list={`colors-list-${line.id}`}
                    placeholder="BLACK"
                    value={line.color_code}
                    onChange={(e) => updateLine(line.id, { color_code: e.target.value.toUpperCase() })}
                  />
                  <datalist id={`colors-list-${line.id}`}>
                    {colors.map((c) => (
                      <option key={c.id} value={c.code}>
                        {c.name_uz}
                      </option>
                    ))}
                  </datalist>
                </div>
                <div className="text-sm font-medium pb-2">
                  Jami: {lineTotal(line)} dona
                </div>
                {lines.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setLines((p) => p.filter((l) => l.id !== line.id))}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr>
                      {sizeColumns.map((sz) => (
                        <th key={sz} className="border px-1 py-1 font-mono bg-muted/50">
                          {sz}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {sizeColumns.map((sz) => (
                        <td key={sz} className="border p-0">
                          <Input
                            type="number"
                            min={0}
                            className="h-8 text-center border-0 rounded-none font-mono text-xs px-1"
                            value={line.size_qty[sz] || ""}
                            onChange={(e) => setSizeQty(line.id, sz, e.target.value)}
                            placeholder="0"
                          />
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <Button type="button" variant="outline" size="sm" onClick={() => setLines((p) => [...p, newLine()])}>
            <Plus className="mr-2 h-4 w-4" /> Yana model qatori
          </Button>
        </div>

        <div>
          <Label>Izoh</Label>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <p className="text-sm font-medium">Umumiy: {grandTotal.toLocaleString()} dona</p>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Bekor
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !clientId || grandTotal === 0}>
            {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Speka yaratish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
