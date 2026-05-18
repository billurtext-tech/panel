// Server-Sent Events (SSE) for realtime dashboard updates.
// Frontend connects to /api/sse/stream and receives JSON events when scans
// happen, BoxApp syncs complete, quality issues arise, etc.

import { Router, Response, NextFunction } from 'express';
import { AuthRequest, JsonValue } from '../../shared/types';
import { requireAuth } from '../../shared/middleware/auth';

const router = Router();

// In-memory set of subscribers — process-local. For multi-instance, use Redis pubsub.
type Subscriber = { res: Response; userId: string; lastPing: number };
const subscribers = new Set<Subscriber>();

router.get('/stream', requireAuth, (req: AuthRequest, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');  // disable nginx buffering
  res.flushHeaders?.();

  const sub: Subscriber = { res, userId: req.user!.id, lastPing: Date.now() };
  subscribers.add(sub);

  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, time: new Date() })}\n\n`);

  const pingInterval = setInterval(() => {
    try { res.write(`: ping\n\n`); sub.lastPing = Date.now(); }
    catch { /* connection closed */ }
  }, 20_000);

  req.on('close', () => {
    clearInterval(pingInterval);
    subscribers.delete(sub);
  });
});

/** Publish an event to all SSE subscribers. */
export function publishEvent(event: string, data: JsonValue) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const sub of subscribers) {
    try { sub.res.write(payload); }
    catch { subscribers.delete(sub); }
  }
}

export default router;
