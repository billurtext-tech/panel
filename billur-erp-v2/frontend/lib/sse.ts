"use client";

import { useEffect, useRef } from "react";

type Handler = (event: string, data: any) => void;

/**
 * Subscribe to backend SSE stream. The callback receives `(event, data)`
 * for every named event. Connection auto-reconnects after disconnects.
 *
 * Usage:
 *   useSSE((event, data) => {
 *     if (event === 'scan') refresh();
 *   });
 */
export function useSSE(handler: Handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;
    let reconnectTimer: any = null;

    function connect() {
      if (cancelled) return;
      try {
        es = new EventSource('/api/sse/stream', { withCredentials: true });

        es.onerror = () => {
          es?.close();
          es = null;
          if (!cancelled) {
            reconnectTimer = setTimeout(connect, 5_000);
          }
        };

        // Listen for any named event
        const events = [
          'hello', 'scan', 'scan.start', 'scan.finish', 'scan.override',
          'quality.decision', 'production.qr.created',
          'boxapp.synced', 'boxapp.failed',
          'order.created', 'payroll.calculated',
        ];
        for (const evt of events) {
          es.addEventListener(evt, (e: MessageEvent) => {
            let data: any = null;
            try { data = JSON.parse(e.data); } catch { data = e.data; }
            handlerRef.current(evt, data);
          });
        }
      } catch {
        reconnectTimer = setTimeout(connect, 5_000);
      }
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, []);
}
