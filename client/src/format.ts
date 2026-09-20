const DAY = 24 * 60 * 60 * 1000;

const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** "Wed 23 Sep, 11:59 pm", or just "Fri 25 Sep" when the notification gave no time of day. */
export function formatDue(iso: string, hasTime: boolean): string {
  const d = new Date(iso);
  return hasTime ? `${dateFmt.format(d)}, ${timeFmt.format(d)}` : dateFmt.format(d);
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** A short, human countdown: "Today", "Tomorrow", "in 4 days", "3 days ago". */
export function countdown(iso: string, now = new Date()): string {
  const days = Math.round((startOfDay(new Date(iso)) - startOfDay(now)) / DAY);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1) return days < 14 ? `in ${days} days` : `in ${Math.round(days / 7)} weeks`;
  return `${-days} days ago`;
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
