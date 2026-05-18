"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Search, Package, Scan, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface OrderListItem {
  id: string;
  external_code: string;
  client_name: string;
  total_pieces: number;
  total_boxed: number;
  total_remaining: number;
  is_complete: boolean;
}

interface OrderProgress {
  order_id: string;
  external_code: string;
  status: string;
  client_name: string;
  total_ordered: number;
  total_boxed: number;
  total_remaining: number;
  is_complete: boolean;
  items: Array<{
    id: string;
    size_code: string;
    model_code: string;
    color_code: string;
    ordered_qty: number;
    boxed_qty: number;
    remaining_qty: number;
    is_complete: boolean;
  }>;
  boxes: Array<{ uid: string; box_num: string; status: string }>;
}

export default function BoxUIPage() {
  const [orderCode, setOrderCode] = useState("");
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const [barcode, setBarcode] = useState("");
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [boxNum, setBoxNum] = useState("1");
  const scanRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ["boxui-orders"],
    queryFn: () => api.get<OrderListItem[]>("/api/box-production/orders"),
    refetchInterval: 30_000,
  });

  const { data: progress, isLoading: progressLoading, refetch } = useQuery({
    queryKey: ["boxui-progress", activeCode],
    queryFn: () => api.get<OrderProgress>(`/api/box-production/orders/by-code/${encodeURIComponent(activeCode!)}`),
    enabled: !!activeCode,
  });

  const scanMut = useMutation({
    mutationFn: (body: { order_code: string; size_code: string; quantity: number; barcode?: string }) =>
      api.post<{ ok: boolean; message: string; progress: OrderProgress }>("/api/box-production/scan", body),
    onSuccess: (res) => {
      toast.success(res.message);
      qc.setQueryData(["boxui-progress", activeCode], res.progress);
      setBarcode("");
      scanRef.current?.focus();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createBoxMut = useMutation({
    mutationFn: () =>
      api.post("/api/box-production/boxes", {
        order_code: activeCode,
        box_num: boxNum,
        model: progress?.items[0]?.model_code,
        color: progress?.items[0]?.color_code,
      }),
    onSuccess: () => {
      toast.success("Box yaratildi");
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const loadOrder = (code: string) => {
    setActiveCode(code.trim());
    setOrderCode(code.trim());
  };

  useEffect(() => {
    if (activeCode) scanRef.current?.focus();
  }, [activeCode]);

  const handleBarcodeScan = () => {
    if (!activeCode || !barcode.trim()) return;
    const raw = barcode.trim().toUpperCase();
    let size = selectedSize;
    let qty = 1;

    // Format: SIZE or SIZE:QTY or ORDER-SIZE-QTY
    if (raw.includes(":")) {
      const [s, q] = raw.split(":");
      size = s;
      qty = parseInt(q, 10) || 1;
    } else if (progress?.items.some(i => i.size_code === raw)) {
      size = raw;
    } else {
      const match = progress?.items.find(i => raw.endsWith(i.size_code));
      if (match) size = match.size_code;
    }

    if (!size) {
      toast.error("O'lcham aniqlanmadi. O'lchamni tanlang yoki SIZE:QTY formatida skanerlang");
      return;
    }

    scanMut.mutate({
      order_code: activeCode,
      size_code: size,
      quantity: qty,
      barcode: raw,
    });
  };

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      {/* Order search */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-emerald-400 flex items-center gap-2">
            <Search className="h-4 w-4" /> Zakaz qidirish (faqat ERP)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="Zakaz raqami: LRTT-88"
              value={orderCode}
              onChange={e => setOrderCode(e.target.value)}
              onKeyDown={e => e.key === "Enter" && loadOrder(orderCode)}
              className="bg-slate-800 border-slate-700"
            />
            <Button onClick={() => loadOrder(orderCode)} disabled={!orderCode.trim()}>
              Yuklash
            </Button>
          </div>

          {ordersLoading ? (
            <Loader2 className="h-5 w-5 animate-spin mx-auto" />
          ) : (
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
              {orders.map(o => (
                <button
                  key={o.id}
                  onClick={() => loadOrder(o.external_code)}
                  className={cn(
                    "text-xs px-2 py-1 rounded border transition-colors",
                    activeCode === o.external_code
                      ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                      : "border-slate-700 text-slate-400 hover:border-slate-500"
                  )}
                >
                  {o.external_code}
                  <span className="ml-1 opacity-60">({o.total_remaining})</span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {activeCode && (
        <>
          {progressLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
          ) : progress ? (
            <>
              {/* Order header */}
              <Card className="bg-slate-900 border-slate-800">
                <CardContent className="pt-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h2 className="text-xl font-bold text-white">{progress.external_code}</h2>
                      <p className="text-sm text-slate-400">{progress.client_name}</p>
                      {progress.items[0] && (
                        <p className="text-xs text-slate-500 mt-1">
                          {progress.items[0].model_code} · rang {progress.items[0].color_code}
                        </p>
                      )}
                    </div>
                    {progress.is_complete ? (
                      <Badge className="bg-emerald-600">Tugadi</Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-500 text-amber-400">
                        {progress.total_remaining} qoldi
                      </Badge>
                    )}
                  </div>
                  <div className="mt-3 h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{ width: `${progress.total_ordered ? (progress.total_boxed / progress.total_ordered) * 100 : 0}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {progress.total_boxed} / {progress.total_ordered} dona
                  </p>
                </CardContent>
              </Card>

              {/* Size grid */}
              <Card className="bg-slate-900 border-slate-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-slate-300">O'lchamlar</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                    {progress.items.map(item => (
                      <button
                        key={item.id}
                        onClick={() => setSelectedSize(item.size_code)}
                        disabled={item.is_complete}
                        className={cn(
                          "p-2 rounded-lg border text-center text-sm transition-all",
                          item.is_complete && "opacity-40 cursor-not-allowed border-slate-800",
                          !item.is_complete && selectedSize === item.size_code && "border-emerald-500 bg-emerald-500/20",
                          !item.is_complete && selectedSize !== item.size_code && "border-slate-700 hover:border-slate-500"
                        )}
                      >
                        <div className="font-bold">{item.size_code}</div>
                        <div className="text-[10px] text-slate-400">
                          {item.boxed_qty}/{item.ordered_qty}
                        </div>
                        {item.is_complete && <CheckCircle2 className="h-3 w-3 mx-auto text-emerald-500 mt-1" />}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Barcode scanner */}
              {!progress.is_complete && (
                <Card className="bg-slate-900 border-slate-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
                      <Scan className="h-4 w-4" /> Barcode scan
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {selectedSize && (
                      <Alert className="bg-emerald-500/10 border-emerald-500/30">
                        <AlertDescription className="text-emerald-300 text-sm">
                          Tanlangan: <strong>{selectedSize}</strong> — barcode skanerlang
                        </AlertDescription>
                      </Alert>
                    )}
                    <div className="flex gap-2">
                      <Input
                        ref={scanRef}
                        placeholder="Barcode yoki 104:5"
                        value={barcode}
                        onChange={e => setBarcode(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleBarcodeScan()}
                        className="bg-slate-800 border-slate-700 font-mono"
                        autoFocus
                      />
                      <Button
                        onClick={handleBarcodeScan}
                        disabled={scanMut.isPending || !selectedSize}
                        className="bg-emerald-600 hover:bg-emerald-700"
                      >
                        {scanMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Scan"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Create box */}
              <Card className="bg-slate-900 border-slate-800">
                <CardContent className="pt-4 flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="text-xs text-slate-500">Box raqami</label>
                    <Input
                      value={boxNum}
                      onChange={e => setBoxNum(e.target.value)}
                      className="bg-slate-800 border-slate-700"
                    />
                  </div>
                  <Button
                    variant="outline"
                    className="border-slate-600"
                    onClick={() => createBoxMut.mutate()}
                    disabled={createBoxMut.isPending}
                  >
                    <Package className="h-4 w-4 mr-1" />
                    Box yaratish
                  </Button>
                </CardContent>
              </Card>

              {progress.is_complete && (
                <Alert className="bg-emerald-500/10 border-emerald-500/30">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <AlertDescription className="text-emerald-300">
                    Zakaz to'liq qadoqlandi!
                  </AlertDescription>
                </Alert>
              )}

              {progress.boxes.length > 0 && (
                <Card className="bg-slate-900 border-slate-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-slate-400">Boxlar ({progress.boxes.length})</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    {progress.boxes.map(b => (
                      <div key={b.uid} className="flex justify-between text-sm text-slate-300">
                        <span>#{b.box_num}</span>
                        <Badge variant="outline" className="text-[10px]">{b.status}</Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>Zakaz topilmadi</AlertDescription>
            </Alert>
          )}
        </>
      )}
    </div>
  );
}
