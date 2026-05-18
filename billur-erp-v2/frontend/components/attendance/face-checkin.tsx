"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, MapPin, Camera, LogIn, LogOut } from "lucide-react";
import { useGeolocation } from "@/lib/hooks/use-geolocation";
import { useFaceCapture } from "@/lib/hooks/use-face-capture";
import { api } from "@/lib/api/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface FaceCheckInProps {
  isCheckedIn: boolean;
  onSuccess?: () => void;
}

export function FaceCheckIn({ isCheckedIn, onSuccess }: FaceCheckInProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { coords, error: geoError, loading: geoLoading, requestLocation, isInRange } = useGeolocation();
  const { startCamera, stopCamera, capture, ready, error: camError } = useFaceCapture();
  const [submitting, setSubmitting] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    const v = videoRef.current;
    if (v) startCamera(v);
    return () => stopCamera();
  }, [startCamera, stopCamera]);

  const handleCheck = async (type: "check_in" | "check_out") => {
    setSubmitting(true);
    try {
      const loc = coords || (await requestLocation());
      if (!loc || loc.distance > 10) {
        toast.error(geoError || "Ofis hududida emassiz (10m radius)");
        return;
      }
      const face = capture();
      if (!face) {
        toast.error("Yuzni kameraga qarang");
        return;
      }
      const endpoint = type === "check_in" ? "/api/attendance/check-in" : "/api/attendance/check-out";
      await api.post(endpoint, {
        latitude: loc.lat,
        longitude: loc.lon,
        face_descriptor: face.descriptor,
        face_snapshot: face.snapshot,
        device_info: navigator.userAgent.slice(0, 200),
      });
      toast.success(type === "check_in" ? "Keldingiz belgilandi" : "Ketdingiz belgilandi");
      qc.invalidateQueries({ queryKey: ["worker-stats"] });
      qc.invalidateQueries({ queryKey: ["attendance-status"] });
      onSuccess?.();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Xato";
      if (msg.includes("ro'yxatdan o'tmagan") || msg.includes("Yuz ma")) {
        toast.error("Avval yuzni ro'yxatdan o'tkazing");
      } else {
        toast.error(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleEnroll = async () => {
    setEnrolling(true);
    try {
      const face = capture();
      if (!face) {
        toast.error("Yuzni kameraga qarang");
        return;
      }
      await api.post("/api/attendance/enroll-face/self", {
        face_descriptor: face.descriptor,
      });
      toast.success("Yuz muvaffaqiyatli ro'yxatdan o'tdi");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Xato");
    } finally {
      setEnrolling(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Camera className="h-4 w-4" /> Davomat (Face ID)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative aspect-[4/3] bg-muted rounded-lg overflow-hidden">
          <video ref={videoRef} className="w-full h-full object-cover mirror" playsInline muted />
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          )}
        </div>

        {(camError || geoError) && (
          <Alert variant="destructive">
            <AlertDescription>{camError || geoError}</AlertDescription>
          </Alert>
        )}

        <Button variant="outline" className="w-full" onClick={requestLocation} disabled={geoLoading}>
          <MapPin className="mr-2 h-4 w-4" />
          {geoLoading ? "Joylashuv..." : coords
            ? `Masofa: ${Math.round(coords.distance)}m ${isInRange ? "✓" : "✗"}`
            : "Joylashuvni tekshirish"}
        </Button>

        <div className="grid grid-cols-2 gap-2">
          <Button
            className="w-full"
            disabled={submitting || isCheckedIn}
            onClick={() => handleCheck("check_in")}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
            Kelish
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            disabled={submitting || !isCheckedIn}
            onClick={() => handleCheck("check_out")}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
            Ketish
          </Button>
        </div>

        <Button variant="ghost" size="sm" className="w-full text-xs" onClick={handleEnroll} disabled={enrolling}>
          {enrolling ? "..." : "Yuzni birinchi marta ro'yxatdan o'tkazish"}
        </Button>
      </CardContent>
    </Card>
  );
}
