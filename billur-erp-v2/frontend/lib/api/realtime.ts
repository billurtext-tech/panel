"use client"

import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { getToken } from "../api/client"

/**
 * Subscribe to server-sent events from the backend.
 * Auto-invalidates the listed query keys when an event arrives.
 *
 * Usage:
 *   useRealtime({
 *     onScan: () => qc.invalidateQueries({ queryKey: ['dashboard'] })
 *   })
 */
export function useRealtime(handlers?: {
  onScan?: (data: any) => void
  onBoxAppSync?: (data: any) => void
  onQuality?: (data: any) => void
}) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    const token = getToken()
    if (!token || typeof window === "undefined") return

    // EventSource doesn't support custom headers, so we pass the token as a
    // query param. The /api/sse/stream backend looks at this fallback.
    // (For best security, prefer a cookie-based session.)
    const es = new EventSource(`/api/sse/stream?token=${encodeURIComponent(token)}`, {
      withCredentials: true,
    })

    es.addEventListener("scan", (ev: any) => {
      try {
        const data = JSON.parse(ev.data)
        handlersRef.current?.onScan?.(data)
      } catch {}
    })

    es.addEventListener("boxapp_sync", (ev: any) => {
      try {
        const data = JSON.parse(ev.data)
        handlersRef.current?.onBoxAppSync?.(data)
      } catch {}
    })

    es.addEventListener("quality", (ev: any) => {
      try {
        const data = JSON.parse(ev.data)
        handlersRef.current?.onQuality?.(data)
      } catch {}
    })

    es.onerror = () => {
      // Browser auto-reconnects, just swallow
    }

    return () => es.close()
  }, [])
}

/** Convenience: invalidate dashboard queries on any scan event. */
export function useRealtimeDashboard() {
  const qc = useQueryClient()
  useRealtime({
    onScan: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] })
      qc.invalidateQueries({ queryKey: ["qr-codes"] })
    },
    onBoxAppSync: () => {
      qc.invalidateQueries({ queryKey: ["boxapp-jobs"] })
      qc.invalidateQueries({ queryKey: ["boxapp-stats"] })
    },
    onQuality: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] })
      qc.invalidateQueries({ queryKey: ["quality"] })
    },
  })
}
