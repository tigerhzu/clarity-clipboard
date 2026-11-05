export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// Construct both local midnights independently: a DST day is not always 24 hours.
export function dayRange(value: string | null): { startMs?: number; endMs?: number } {
  if (!value) return {};
  const start = parseLocalDate(value);
  return { startMs: +start, endMs: +new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1) };
}
