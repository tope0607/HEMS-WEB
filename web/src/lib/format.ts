/** Formatting helpers — numbers are grouped with thin spaces, mono-friendly. */

const THIN_SPACE = ' ';

export function fmtInt(n: number): string {
  return Math.round(n)
    .toLocaleString('en-US')
    .replace(/,/g, THIN_SPACE);
}

export function fmtWatts(w: number): string {
  return fmtInt(w);
}

export function fmtKwh(kwh: number): string {
  return kwh >= 100 ? fmtInt(kwh) : kwh.toFixed(1);
}

export function fmtNaira(n: number): string {
  return `₦${fmtInt(n)}`;
}

export function fmtCompactW(w: number): string {
  if (Math.abs(w) >= 1000) return `${(w / 1000).toFixed(1)}k`;
  return String(Math.round(w));
}

export function fmtClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  const day = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  return `${day} ${fmtClock(ts)}`;
}

export function fmtRelative(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const body = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
