"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { FaceCheckIn } from "@/components/attendance/face-checkin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

interface AttendanceStatus {
  is_checked_in: boolean;
  last_record: { record_type: string; recorded_at: string } | null;
  today_records: Array<{ record_type: string; recorded_at: string }>;
}

export default function WorkerAttendancePage() {
  const { data, refetch } = useQuery({
    queryKey: ["attendance-status"],
    queryFn: () => api.get<AttendanceStatus>("/api/attendance/status"),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Davomat</h1>

      <FaceCheckIn
        isCheckedIn={data?.is_checked_in ?? false}
        onSuccess={() => refetch()}
      />

      {data?.today_records && data.today_records.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Bugungi yozuvlar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.today_records.map((r, i) => (
              <div key={i} className="flex justify-between items-center text-sm">
                <Badge variant={r.record_type === "check_in" ? "default" : "secondary"}>
                  {r.record_type === "check_in" ? "Kelish" : "Ketish"}
                </Badge>
                <span className="text-muted-foreground">
                  {format(new Date(r.recorded_at), "HH:mm")}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
