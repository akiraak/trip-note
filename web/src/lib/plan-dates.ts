// プランの日付まわりの純粋な計算。DB に触れないので、Server Action からも
// クライアントコンポーネント(編集フォームの予告文言)からも使える

/** YYYY-MM-DD どうしの日数差(暦日で数える。不正な日付は 0) */
export function dayDifference(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

/** 出発日の変更に合わせてプランをずらす日数(iOS の PlanEditor.departureShiftDays と同じ規則)。
 *  **出発日を変えたら 1 日目がその日になるようにそろえる**(元からずれていた分も直る)。
 *  日どうしの間隔は保つ。日付が変わっていない(時刻だけの変更)/ 出発日が無い(消した)/
 *  日が 1 つも無い場合は 0。日付はすべて表示タイムゾーンの壁時計の YYYY-MM-DD で渡す */
export function departureShiftDays(
  oldDepartureDate: string | null,
  newDepartureDate: string | null,
  firstDayDate: string | null,
): number {
  if (!newDepartureDate || !firstDayDate) return 0;
  // 出発日そのものが変わっていなければ触らない(時刻だけ直したときに動くと驚くため)
  if (oldDepartureDate === newDepartureDate) return 0;
  return dayDifference(firstDayDate, newDepartureDate);
}

/** 編集フォームで出す予告文言(動かないなら null) */
export function planShiftNotice(offsetDays: number): string | null {
  if (offsetDays === 0) return null;
  return offsetDays > 0
    ? `プランの日付も ${offsetDays} 日うしろへ動きます`
    : `プランの日付も ${-offsetDays} 日まえへ動きます`;
}
