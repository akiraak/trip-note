const dateTimeFormat = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Tokyo",
});

const timeFormat = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Asia/Tokyo",
});

export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

export function formatPointTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}
