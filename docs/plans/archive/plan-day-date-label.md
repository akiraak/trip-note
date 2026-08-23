# プランの「N日目」の横に日付を表示する(Aug 25 形式に統一)

## 目的・背景

プランの日を見たときに「その日が何月何日なのか」が一目で分かるようにする(例: `1日目 Aug 25`)。

現状の棚卸し(2026-08-23 時点):

| 表示箇所 | 現状 |
| --- | --- |
| iOS 旅行画面のプラン一覧 `TripDayRow` (`Views/TripDetailView.swift:398`) | `1日目` + `8月25日(月)`(端末ロケール依存) |
| iOS 日詳細のタイトル `TripDayDetailView.dayTitle` (`Views/TripDayDetailView.swift:219`) | **`1日目` のみ(日付なし)** |
| iOS 日詳細の「日付」行 `displayDate` (同 :224) | `2026年8月25日(月)`(年つき) |
| iOS AI 行程提案プレビュー (`Views/AIPlanSuggestView.swift:113`) | `1日目 8月25日(月) <行程>` |
| Web 日カードのヘッダ (`app/trips/[id]/plan-section.tsx:157`) | `1日目 8/25(月)`(`formatDay`) |
| Web AI 提案プレビュー (`app/trips/[id]/ai-plan.tsx:161`) | 同上 |

つまり「日付が出ていない箇所」は iOS 日詳細のタイトルだけで、残りは**書式がばらばら**
(iOS は端末ロケール依存、Web は `M/D(曜)`)。日付を足すのと同時に書式を `Aug 25` に揃える。

## 対応方針

### 表示書式の決定

- `Aug 25` 形式(英語の月略称 + 日)に統一する。ロケールに依存させない
  (iOS は `en_US_POSIX`、Web は `en-US` 固定)ため、端末の言語設定で表示が揺れない
- **曜日は出さない**(「N日目」と併記されるため情報過多になる)。
  ただしフォーマッタは 1 箇所に集約し、`Aug 25 (Mon)` に変えたくなったら
  そこだけ直せば全画面に効く構成にする
- 年は出さない。年が要る唯一の場所(iOS 日詳細の「日付」行)は年つきのまま残す

### iOS

- `Domain/PlanEditor.swift` に日付ラベル用の純関数を追加する
  - `static func displayDate(_ dateString: String) -> String`
    (`YYYY-MM-DD` → `Aug 25`。パースできなければ入力をそのまま返す)
  - 既存の `parseDate` / `formatter(_:)` の隣に置き、`DateFormatter` は
    `en_US_POSIX` + `dateFormat = "MMM d"` 固定にする
- 差し替え先
  - `Views/TripDetailView.swift` の `TripDayRow.dateText` → `PlanEditor.displayDate(day.date)`
  - `Views/TripDayDetailView.swift` の `dayTitle` → `1日目 · Aug 25`
    (日が旅行に紐付かず番号が出せない場合は日付だけ)
  - `Views/AIPlanSuggestView.swift` の `displayDate(_:)` → `PlanEditor.displayDate` に置き換え
    (ローカル関数を削除)
  - 日詳細の「日付」行(`TripDayDetailView.displayDate`)は年つきのまま据え置く

### Web

- `src/lib/format.ts` の `formatDay` を `Aug 25` 形式に変更する
  - `Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })`
  - `trip_days.date` は日付だけの値なので、表示 TZ でずらさないよう **UTC 固定**の
    現状の扱いを維持する
- 呼び出し側(`plan-section.tsx` / `ai-plan.tsx`)は変更不要(`formatDay` の戻り値が変わるだけ)

## 影響範囲

- iOS: `Domain/PlanEditor.swift` / `Views/TripDetailView.swift` /
  `Views/TripDayDetailView.swift` / `Views/AIPlanSuggestView.swift`
  (新規ファイルは追加しないので `xcodegen generate` は不要)
- Web: `src/lib/format.ts` のみ(`formatDay` の利用箇所は 2 ファイルとも表示のみ)
- データモデル・API・同期: 変更なし(表示だけの変更)

## リスク・留意点

- `formatDay` は他の用途に使われていない(grep 済み: `plan-section.tsx` / `ai-plan.tsx` のみ)
  ため、書式変更の巻き添えは無い
- 年をまたぐ旅行(12/31 → 1/1)では一覧に年が出ないが、日詳細の「日付」行で確認できる
- 曜日を出したくなった場合は iOS `PlanEditor.displayDate` と Web `formatDay` の
  2 箇所だけ直せばよい

## テスト方針

- iOS ユニットテスト(`ios/TripNoteTests/PlanEditorTests.swift` に追加):
  `displayDate("2026-08-25") == "Aug 25"` / 1 桁日(`2026-08-05` → `Aug 5`) /
  不正な文字列はそのまま返す
- Web ユニットテスト(`web/test/` に `format.test.ts` を追加):
  `formatDay("2026-08-25") === "Aug 25"` / 月初・月末で UTC 固定のためずれないこと
- 手動: iOS シミュレータでプラン一覧・日詳細タイトル・AI 提案プレビュー、
  Web の旅行詳細で表示を確認する
- `xcodebuild build` / `test`、`npm run lint` / `npm run build` / `npm test` の通過
