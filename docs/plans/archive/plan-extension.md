# 既存プランの続き(帰路など)を、旅行作成時と同じ AI 候補で追加する

## 目的・背景

作成済みの旅行に、**行き先(場所)と出発日時を入れるだけで続きの行程を足せる**ようにする。
例: シアトル → シカゴのプランを作った旅行に、「シアトルまで帰る」区間を追加する。

旅行作成時の「日数・宿泊地候補」(`/api/ai/trip-outline`)が既にこれとほぼ同じことをしている。
入力は 目的地 + 出発日時 + 出発地(名前と座標)で、日数は AI が距離から決める。
**足りないのは出発点だけ**で、作成直後の導線しか無いために出発点が常に旅行の 1 日目になっている。

- AI 側(`lib/ai.ts` の `TripOutlineInput` / `TRIP_OUTLINE_SCHEMA` / `buildTripOutlinePrompt`)、
  ジョブ(`lib/ai-jobs.ts`・`/api/ai/jobs`)、候補の表示 UI(`TripCreateView` の候補セクション /
  `trip-outline-step.tsx`)は**そのまま使える。変更しない**
- 採用だけが 1 日目起点に固定されている
  - iOS `PlanEditor.adopt(_ candidate:into:)`:
    `existingDays.first ?? trip.departureAt ?? now` から `dayCount` 分の日を張る
  - Web `adoptTripOutline`: `existingDays[0]?.date ?? trip.departure_at` から同じ
  - 最終日に置く到着チェックポイントの名前が `trip.destination` 固定

あわせて、もう一つの AI 導線 **「AI で行程を提案」(`/api/ai/plan`)は削除する**。
日数を人が決めて 1 日ごとの中身まで作らせる機能で、続きの追加ができるようになれば使わない。
残すと似た導線が 2 つ並んで紛らわしいため、関連コードごと消す。

## 対応方針

**採用の起点(開始日)と到着地名を引数で渡せるようにするだけ**で、続きの追加を実現する。
新しい AI 機能・新しい入力項目・新しいスキーマ・新しいエンドポイントは作らない。

### 1. 採用の一般化(この変更が本体)

- iOS `PlanEditor.adopt(_ candidate:into:destinationLatitude:destinationLongitude:)` に
  `startDate: Date? = nil` と `destinationName: String? = nil` を追加する。
  省略時は現在と同じ挙動(1 日目起点・`trip.destination`)
- Web `adoptTripOutline(tripId, outline)` の `AdoptOutline` に
  `startDate?: string`(YYYY-MM-DD)と `destination?: string` を追加する。同じく省略時は現状どおり
- 続きの追加では入力した出発日を `startDate`、入力した目的地を `destinationName` に渡す。
  既存の日と重なる日付は既存の日を再利用する現行ロジックがそのまま効くので、
  最終日と同日に出発する場合も日が二重にならない
- 既存行の `updated_at` を進めない・宿泊は n 日目に置く、といった規則は現状のまま

### 2. 導線(旅行詳細から呼ぶ)

入力は 目的地 + 出発日時 の 2 つだけ。出発地は既存プランの**最終地点**
(最後の日の最後のチェックポイント。座標があれば座標も)を自動で使い、画面には表示だけする。
プランに日が無ければ 1 日目の出発チェックポイント(`TripCreateView.departureName(of:)`)、
それも無ければ「未指定」で送る(`TripOutlineInput.departure` は null 許容で、
プロンプトも未指定を想定済み)。リクエストは既存の `AITripOutlineRequest` /
`TripOutlineInput` をそのまま組み立てる。

#### ボタンの位置

どちらも**旅行詳細のプラン(PLAN)セクションの一番下**、日の一覧の下にある既存のボタン行に置く。
「AI で行程を提案」を消すので、ボタンは「日を追加」と並ぶ 2 つになる。

- iOS `Views/TripDetailView.swift` の `planSection` 末尾のボタン行

  ```
  ┌ 旅行詳細(地図の上のボトムシート) ────────┐
  │ 行程  [プラン中]              3 日間      │
  │ 開始 / 終了 / 出発予定 / 目的地 / 地点数… │
  │ PLAN                                      │
  │  1日目 Aug 25  出発 09:00  約 420km       │
  │  2日目 Aug 26  …                          │
  │  3日目 Aug 27  …                          │
  │  ＋日を追加   ✨続きの行程を提案          │← ここ
  │ RECORD / MEDIA / 旅行を削除               │
  └───────────────────────────────────────────┘
  ```

- Web `src/app/trips/[id]/plan-section.tsx` の `PlanSection` 末尾のボタン行。
  場所は左パネル(PC は幅 440px の固定パネル、モバイルは地図の下にせり上がるシート)の
  `Plan` 見出しの下、日カードを並べた直後

#### 押したあとの見せ方

iOS はシート(`.sheet`、`TripCreateView` の候補ステップと同じ見た目)、Web は
ボタン行の上にインライン展開する(削除する `AiPlanSuggest` と同じ流儀)。中身の流れは共通:

1. **入力** — 出発地(読み取り専用。最終地点の名前を表示)/ 目的地(必須)/
   出発日時(日付 + 時刻。既定は最終日の翌日 09:00。日が無ければ `trip.departureAt`)/
   要望(任意)→「候補を出す」
2. **待機** — 「候補を作成中…(1 分ほどかかります)」(既存の文言のまま)
3. **候補一覧** — 候補ごとに タイトル・「2泊3日・泊: ◯◯ → ◯◯」・ミニ地図・
   「この候補を採用」。iOS は `TripCreateView` の `summary(of:)` / `mapPoints(for:)` /
   `OutlineCandidateMap`、Web は `trips/new/trip-outline-step.tsx` をそのまま使う
   (両方から呼べるよう切り出す)
4. **採用** — 最終日の続きとして日が増え、iOS はシートを閉じる / Web はインラインを閉じる

Server Action(`startTripOutlineAction` / `pollTripOutlineAction` / `adoptTripOutlineAction`)と
iOS の `AIClient.suggestTripOutline` はそのまま使う(採用の引数が増えるだけ)。

#### そのほか

- `trip.destination` は書き換えない(旅行の目的地は最初のまま。追加区間の到着地は
  最終日の `destination` チェックポイントで表す)
- 出発時刻は既存どおり AI への入力にだけ使い、`trip_days.departure_time` には保存しない

### 3. 「AI で行程を提案」(/api/ai/plan) の削除

行程提案(plan)に属するものだけを消す。trip-outline とチェックポイント種別など
共有物は残す。

- **iOS**
  - `Views/AIPlanSuggestView.swift`(ファイルごと削除。削除後 `xcodegen generate` を再実行)
  - `Views/TripDetailView.swift`: `showsAIPlanSuggest` / `.sheet` / ボタン
  - `Models/AIRecords.swift`: `AIPlanRequest` / `AISuggestedCheckpoint` /
    `AISuggestedDay` / `AIPlanSuggestion`
  - `Services/AIClient.swift`: `suggestPlan(_:)`
  - `Domain/PlanEditor.swift`: `adopt(_ suggestion: AIPlanSuggestion, into:)`
  - `TripCreateView.departureName(of:)` は**残す**(続き提案の出発地フォールバックで使う)
- **web**
  - `src/app/api/ai/plan/route.ts`(ディレクトリごと削除)
  - `src/app/trips/[id]/ai-plan.tsx`(ファイルごと削除)
  - `src/lib/ai.ts`: `PlanSuggestionInput` / `SuggestedCheckpoint` / `SuggestedDay` /
    `PlanSuggestion` / `parsePlanInput` / `PLAN_SCHEMA` / `parsePlanSuggestion` /
    `buildPlanPrompt` / `suggestPlan` と、plan 専用の `CHECKPOINT_TYPE_ENUM` /
    `isCheckpointType`(`MAX_DAY_COUNT` は trip-outline でも使うので残す)
  - `src/lib/ai-jobs.ts`: `AiJobKind` を `trip_outline` のみにし、kind 分岐を畳む
  - `src/lib/plan.ts`: `AdoptDay` / `adoptPlanSuggestion`
  - `src/app/trips/[id]/actions.ts`: `PlanSuggestResult` / `suggestPlanAction` / `adoptPlanAction`
  - `src/app/trips/[id]/plan-section.tsx`: `aiOpen` と `AiPlanSuggest` の呼び出し、
    `aiDefaults` prop / `trip-canvas.tsx` の `aiDefaults` prop / `page.tsx` の `aiDefaults` 算出
- **DB**: `ai_jobs.kind` の check 制約(`in ('plan','trip_outline')`)は据え置く。
  新規に plan は登録されないだけで、制約を外すためのテーブル再作成はしない
- **互換性**: 単一ユーザー前提のため、サーバ更新後に旧 iOS から plan を呼ぶと 400 になる。
  アプリも同時に更新するので許容する(仕様書からも旧クライアント互換の記述を消す)

## 影響範囲

### web/

- `src/lib/plan.ts`: `AdoptOutline` に `startDate` / `destination`、`adoptTripOutline` の起点と到着地名。
  plan 採用(`AdoptDay` / `adoptPlanSuggestion`)は削除
- `src/app/trips/new/trip-outline-step.tsx`: 旅行詳細からも使えるよう共有化
  (作成直後の使い方は変えない)
- `src/app/trips/[id]/plan-section.tsx`: 導線と入力フォーム(plan 提案の呼び出しは削除)
- `src/lib/ai.ts` / `src/lib/ai-jobs.ts` / `src/app/api/ai/` / `src/app/trips/[id]/actions.ts`:
  plan 関連の削除のみ(trip-outline 側は変更なし)
- `trips/new/actions.ts` は変更なし

### ios/

- `Domain/PlanEditor.swift`: `adopt(_ candidate:)` に `startDate` / `destinationName`。
  plan 採用の `adopt(_ suggestion:)` は削除
- `Views/TripCreateView.swift`: 候補セクションの切り出し(表示内容は変えない)
- `Views/TripDetailView.swift`: 導線の差し替え
- 続き追加の入力シート(切り出した候補セクションを使う)
- `Models/AIRecords.swift` / `Services/AIClient.swift`: plan 関連の削除のみ
- ファイルの追加・削除をするので `xcodegen generate` を再実行する

### その他

- API は `/api/ai/trip-outline` と `/api/ai/jobs`(kind = trip_outline)が残り、
  `/api/ai/plan` が無くなる。`docs/specs/server-api.md` を更新する
- DB スキーマの変更はなし

## テスト方針

- **web(vitest)**
  - `test/plan.test.ts` の `adoptTripOutline`
    - `startDate` 省略時が現状どおり(既存の初日 ?? departure_at 起点)であること
    - `startDate` 指定時にその日から `dayCount` 分の日が張られ、既存の日と重なる日付は
      既存の日が再利用されること(既存行の `updated_at` が進まないことも従来どおり確認)
    - `destination` 指定時に最終日の到着チェックポイントがその名前になること
  - 削除に伴い `adoptPlanSuggestion` / `parsePlanInput` / `parsePlanSuggestion` /
    `buildPlanPrompt` のテストを削除し、`test/ai-jobs.test.ts` の kind は
    `trip_outline` に寄せる
- **iOS(xcodebuild test)**
  - `PlanEditorTests`: `startDate` / `destinationName` の有無での挙動(上と同じ 3 点)。
    unmanaged なエンティティで書く
  - 削除に伴い plan 採用・plan DTO のテスト(`PlanEditorTests` の該当ケース、
    `AIRecordsTests` の plan 部分)を削除。ジョブ応答のテストは
    `AITripOutlineSuggestion` に置き換える
- `npm run lint` / `npm run build` / iOS ビルド + 全テストの通過
- 実機で 1 往復確認: 既存プランのある旅行に目的地と出発日時を入れて候補を出し、
  採用した日程が最終日の続きとして並ぶこと(iOS / Web の両方で表示されること)

## Phase

- **Phase 1**: 採用の起点・到着地名の引数化(Web `lib/plan.ts` + iOS `PlanEditor`)+ テスト
- **Phase 2**: iOS の導線(候補セクションの切り出し + 入力シート + 旅行詳細のボタン)
- **Phase 3**: Web の導線(`trip-outline-step.tsx` の共有化 + `plan-section.tsx` の入力フォーム)
- **Phase 4**: 「AI で行程を提案」(plan)の削除(iOS / web / `server-api.md`)
- **Phase 5**: lint / build / 全テスト + 実機確認
