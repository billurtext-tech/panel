export function getQueryString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return String(value[0] ?? '');
  }

  return '';
}

export function getOptionalQueryString(
  value: unknown
): string | undefined {
  const v = getQueryString(value);
  return v || undefined;
}
