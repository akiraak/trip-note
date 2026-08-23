// 表示タイムゾーンは g3plus の既定(America/Los_Angeles)に合わせる
export const TIME_ZONE = "America/Los_Angeles";

const dateTimeFormat = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: TIME_ZONE,
});

const timeFormat = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: TIME_ZONE,
});

// trip_days.date (YYYY-MM-DD) 用。日付だけの値を表示 TZ でずらさないよう UTC で整形する
const dayFormat = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  weekday: "short",
  timeZone: "UTC",
});

export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

/** YYYY-MM-DD → 例: 9/1(火) */
export function formatDay(dateString: string): string {
  return dayFormat.format(new Date(`${dateString}T00:00:00Z`));
}

export function formatPointTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}
