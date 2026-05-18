import type { JsonValue } from '../types';

/** Coerce unknown runtime values into JSON-serializable JsonValue (omits undefined keys). */
export function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }

  if (typeof value === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val === undefined) continue;
      out[key] = toJsonValue(val);
    }
    return out;
  }

  return String(value);
}
