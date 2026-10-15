const MS_DAY = 86_400_000;

/** Parse YYYY-MM-DD as a local calendar date (not UTC midnight). */
export function parseDate(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function toISODate(date: Date): string {
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function addDays(value: string, days: number): string {
  const date = parseDate(value);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

export function daysFromToday(value: string): number {
  const today = parseDate(todayISO());
  return Math.round((parseDate(value).getTime() - today.getTime()) / MS_DAY);
}

export function formatDate(value: string | null | undefined, locale = 'en-CA'): string {
  if (!value) return '—';
  return parseDate(value).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(value: string, locale = 'en-CA'): string {
  return new Date(value).toLocaleString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function relativeDay(value: string | null | undefined): string {
  if (!value) return 'No date';
  const n = daysFromToday(value);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return n > 0 ? `In ${n} days` : `${-n} days ago`;
}

export function money(amount: number, locale = 'en-CA'): string {
  return amount.toLocaleString(locale, { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
}

export function humanize(value: string): string {
  const text = value.replace(/[_.]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
