# 旅行画面・プランの表示情報を iOS と揃える(Web)

## 目的・背景

iOS と Web は同じデータ(trips / trip_days / checkpoints / media / location_points)を見ているのに、
Web の旅行詳細(`web/src/app/trips/[id]/`)には iOS の画面にある情報がいくつか出ていない。
Web だけを見ていると分からない項目があるので、**iOS の画面に出ている情報は Web にも出す**。

Web には日詳細ページが無く、プランは旅行詳細に一体で表示している。そのため
**iOS の「日詳細(`TripDayDetailView`)」の情報は Web では日カードに集約する**。

## 現状の差分(iOS にあって Web に無いもの)

`ios/TripNote/Views/TripDetailView.swift`(旅行詳細 + `TripDayRow`)、
`TripDayDetailView.swift`(日詳細 + `CheckpointRow`)と Web を突き合わせた結果。

| 情報 | iOS の出どころ | Web の現状 |
| --- | --- | --- |
| チェックポイントの**種別ラベル**(「観光」「宿泊」等の文字) | `CheckpointRow`(名前の下) | 絵文字のみ(`title` 属性だけ) |
| 座標が無いことの文言 | 「座標未設定」 | 「位置未定」(不一致) |
| 日の**出発時刻**(`trip_days.departure_time`) | 日詳細の `LabeledContent("出発時刻")` | 出していない |
| 日付の**曜日** | 日詳細の `displayDate`(`2026年9月1日(火)`) | `Sep 1` のみ |
| **チェックポイントなし**の空状態 | 日行・日詳細の両方 | 何も出ない |
| **写真・動画がありません**の空状態 | `mediaSection` | セクションごと消える |

**確認して差分が無かったもの**: 開始 / 終了 / 出発予定 / 目的地 / 地点数 / 総距離 /
進行中・未出発の状態表示 / 日の「N日目」「Sep 1」書式(iOS `PlanEditor.displayDate` = `MMM d`) /
行程タイトル / 日のメモ / チェックポイントの名前・予定時刻・メモ / Google Maps へのリンク /
タイムライン(位置情報がありません含む)。

## 対応方針(Web の表示のみ。DB スキーマ・API・同期契約・iOS は変更なし)

### Step 1: チェックポイント行の情報を揃える

`plan-section.tsx` の `CheckpointRow`。iOS の `CheckpointRow` と同じ並び(名前の下に
「種別 · 時刻 · 座標の有無」)にする。

- 絵文字の右に **種別ラベル**(`CHECKPOINT_LABELS`)を文字で出す
- 「位置未定」→ **「座標未設定」**(iOS の文言に合わせる)
- 予定時刻・メモは現状のまま

### Step 2: 日カードの情報を揃える(iOS の日詳細ぶんを集約)

- ヘッダの日付に**曜日**を併記(`Sep 1 (火)`)。`lib/format.ts` に `formatDayWithWeekday` を足す
  - 「N日目 Sep 1」の書式(コミット 785b816 で iOS と揃えたもの)は崩さず、曜日だけ足す
- **出発時刻**を出す(`day.departure_time` があるときだけ。「出発 08:00」)
  - `PlanDay` に `departure_time` を足し、`page.tsx` の SQL 射影に加える
  - **編集はしない**(iOS で設定 → 同期で流れてくる。`lib/plan.ts` の `updateTripDay` は
    既に `departure_time` を受け付けるので、編集 UI を足すのは別タスク)
- チェックポイントが 0 件の日に**「チェックポイントなし」**を出す

### Step 3: 旅行画面の空状態を揃える

- メディアが 0 件のとき「**写真・動画がありません**」を出す(今はセクションごと消える)

### Step 4: CLAUDE.md に方針を書く

「iOS と Web で表示情報を揃える」を規約として明記する(この差分がまた開かないように)。
Web に日詳細が無いぶんの写像(iOS の日詳細 → Web の日カード)も書く。

## 影響範囲

- web(変更): `src/app/trips/[id]/plan-section.tsx` / `src/app/trips/[id]/page.tsx` /
  `src/lib/format.ts`
- `CLAUDE.md`(規約の追記)
- DB スキーマ・`/api/*`・同期契約・iOS: 変更なし
- デプロイ: 通常の rebuild のみ

## テスト方針

- vitest: `formatDayWithWeekday`(曜日の付与。表示 TZ でずれないこと)
- `npm run lint` / `npm run build`
- 手動(`npm run dev`): 種別ラベル・座標未設定・出発時刻・曜日・空状態(チェックポイントなし /
  写真・動画がありません)の表示

## スコープ外

- **走行距離「約 N km」**(日行)と**到着予想「到着 HH:MM 頃」**(チェックポイント行)、
  **トップ地図の破線プランルート** → いずれもレグ解決が要るので
  `docs/plans/web-plan-route.md`(Step 4)で入れる
- **操作の差**(表示情報ではないもの): 旅行の編集(タイトル・出発予定・目的地)、旅行を終了、
  日の出発時刻の編集、GPS 記録・撮影(iOS 固有)。TODO に別項目として残す
- 旅行一覧(`/`)と iOS の `ContentView` の突き合わせ
