# 旅行作成フローの変更(出発日時・目的地 + AI 日数・宿泊地候補)

## 目的・背景

現在の旅行作成フォーム(iOS `TripCreateView`)はタイトル・移動手段・開始日・日数を入力する。
しかし「開始日」は日付だけで出発時刻の概念がなく、日数は作成時点では決まっていないことが多い。
そこで作成時の入力を「出発日時 + 目的地」に変え、日数と宿泊地は AI に候補を出させて
選ぶだけで大枠が決まるフローにする。

- 開始日(日付のみ) → **出発日時**(日付 + 時刻)に変更
- **日数の入力を廃止**(作成時は 1 日目のみ作る)
- **目的地**を入力に追加
- 作成直後に出発日時・目的地・移動手段から **AI が日数と宿泊地の候補を提示** →
  選ぶと日別プラン(trip_days)と宿泊チェックポイントが作られる

## 対応方針

### Phase 1: データモデルと同期(departure_at / destination)

- web migration 5: `alter table trips add column departure_at text` /
  `add column destination text`(どちらも nullable。ADD COLUMN のみで再作成不要)
  - `departure_at`: 出発予定日時(ISO8601)。実績の `started_at` とは別物。
    プラン 1 日目の日付はこの日付から導出する
  - `destination`: 目的地(自由記述。AI 候補出しの入力)
- `types.ts` の `Trip`、`/api/sync`(型ガード + upsert)、`/api/sync/pull`(select)に追加
- iOS: `TripEntity` にフィールド追加、`TripRecord` / `TripPullRecord` /
  `PlanPull.apply / makeTrip` を追従
- 旧クライアント互換: sync では省略可(null 扱い)にする

### Phase 2: iOS 旅行作成フォームの変更

- `TripCreateView`: タイトル・移動手段・**出発日時**(DatePicker date + hourAndMinute)・
  **目的地**(TextField)。日数 Stepper は削除
- `PlanEditor.makeTrip` を変更: trip(departureAt / destination 付き)+
  **1 日目の trip_day だけ**(出発日時の日付)を作る
- `TripEditView` にも出発日時・目的地の編集を追加(作成後に直せるように)
- `TripDetailView` のヘッダに出発予定・目的地を表示
- 目的地は任意入力。未入力なら AI 候補ステップをスキップして従来通り閉じる

### Phase 3: AI 日数・宿泊地候補 API(web)

- `lib/ai.ts` に trip-outline 系を追加:
  - 入力 `TripOutlineInput = { destination, departureDate (YYYY-MM-DD),
    departureTime (HH:mm), transport, request }`(日時はクライアントのローカル値。
    TZ 変換を避けるため日付と時刻を分けて文字列で受ける)
  - 出力 `TripOutlineSuggestion = { candidates: [{ dayCount, title,
    nights: [{ area, name, note }] }] }`。候補は日数違いで 2〜4 件、
    nights は泊数分(dayCount - 1)。name は「◯◯温泉の宿」など検索しやすい表現
  - スキーマは既存と同じ方針(全 required + 空文字 = 無し、座標は返さない)
  - バリデーション・プロンプト・パースをユニットテスト対象にする
- `/api/ai/trip-outline` route(Bearer + 手書き型ガード 400 + AI 失敗 500)。
  既存 plan route と同じ構成
- `server-api.md` に追記

### Phase 4: iOS 候補出し UI と採用ロジック

- `AIRecords.swift` に outline 系 DTO、`AIClient` に `suggestTripOutline` を追加
- `TripCreateView` を 2 ステップ化: 作成(保存 + sync)→ 目的地があれば同じ
  NavigationStack 内で候補ステップへ遷移し自動で取得開始(スキップ / 閉じる可。
  失敗しても旅行は作成済みなので閉じるだけ)
- 候補は「2泊3日 …」のようなリストで表示し、選択すると採用
- `PlanEditor.adopt(outline:)`: 1 日目の日付から dayCount 分の日を作り
  (既存日付は再利用)、各泊の日に lodging チェックポイントを末尾追記
  (座標未定。既存行の updatedAt は進めない = AI plan 採用と同じ規則)

### Phase 5: Web 表示とドキュメント

- Web 旅行詳細ページに出発予定・目的地を表示(編集 UI は今回はスコープ外)
- `docs/specs/server-api.md` 追従(sync / pull の新カラム、/api/ai/trip-outline)

## 影響範囲

- web: `db.ts`(migration 5)、`types.ts`、`/api/sync`、`/api/sync/pull`、
  `lib/ai.ts`、`/api/ai/trip-outline`(新設)、trips/[id] ページ表示
- iOS: `Entities.swift` / `SyncRecords.swift` / `PullRecords.swift` / `AIRecords.swift`、
  `PlanPull.swift` / `PlanEditor.swift`、`TripCreateView` / `TripEditView` /
  `TripDetailView`、`AIClient.swift`
- docs: `server-api.md`
- 互換性: 追加カラムはすべて nullable。旧クライアントの sync ペイロードは
  そのまま受け付ける(省略 = null)

## テスト方針

- web (vitest): sync の新カラム LWW 往復(sync.test.ts)、
  trip-outline の入力バリデーション・プロンプト・応答パース(ai.test.ts)。
  `npm run lint` / `npm run build`
- iOS: unmanaged エンティティで `PlanEditorTests`(makeTrip が 1 日目のみ作る /
  adopt(outline:) の日生成と宿泊 CP 追記)、`SyncRecordTests` / `PlanPullTests`
  (新フィールドのエンコード / LWW 反映)、`AIRecordsTests`(outline DTO のデコード)。
  シミュレータビルド + テスト(ファイル追加は無い想定だが xcodegen 再実行を確認)
- 実 AI 呼び出しは手動確認
