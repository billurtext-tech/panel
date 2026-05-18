import { ApiError } from './client';

/** User-facing message from API / network errors. */
export function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message || `HTTP ${err.status}`;
  if (err instanceof Error) return err.message;
  return "Noma'lum xato";
}

export function logApiError(context: string, err: unknown): void {
  if (err instanceof ApiError) {
    console.error(`[API] ${context}`, { status: err.status, code: err.code, message: err.message });
  } else {
    console.error(`[API] ${context}`, err);
  }
}
