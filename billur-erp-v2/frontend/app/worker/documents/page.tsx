"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, FileText } from "lucide-react";

export default function WorkerDocumentsPage() {
  const { data: worker } = useQuery({
    queryKey: ["my-worker"],
    queryFn: () => api.get<{ id: string } | null>("/api/worker-profile/me"),
  });

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["my-documents", worker?.id],
    queryFn: () => api.get<Array<{ id: string; document_type: string; file_name: string; status: string }>>(
      `/api/worker-profile/${worker!.id}/documents`
    ),
    enabled: !!worker?.id,
  });

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Hujjatlarim</h1>
      {!docs.length ? (
        <p className="text-sm text-muted-foreground text-center py-8">Hujjatlar yo'q</p>
      ) : (
        docs.map(doc => (
          <Card key={doc.id}>
            <CardContent className="pt-4 flex items-center gap-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium text-sm">{doc.file_name}</p>
                <p className="text-xs text-muted-foreground">{doc.document_type} · {doc.status}</p>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
