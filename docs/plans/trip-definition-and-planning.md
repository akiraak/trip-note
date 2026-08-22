# 「1つの旅行」の定義とプラン機能

## 目的・背景

現在の `trips` は「記録の開始〜停止」の単位でしかなく、複数日にまたがる旅行や、
GPS が切れた場合のデータ連結、旅行前・旅行中のプラン（行程）管理という概念がない。
本タスクで「1つの旅行」を再定義し、日別のチェックポイントからなるプランを
iOS / Web の両方で作成・編集できるようにする。

## 決定事項（チャットで確定済み）

1. **trips を「旅行」に昇格する**。記録の開始/停止や GPS 切断で trip を分割しない。
   点列の時間ギャップは描画時に区間分けして扱う（親概念 Journey は作らない）
2. **プランは iOS / Web 両方で編集**する（双方向同期）。
   双方向にするのはプラン系エンティティ（trips / trip_days / checkpoints）のみ。
   location_points / media は従来通り不変・一方向アップロードのまま
3. **調査機能**: AI で大まかな日別行程を作成 → 各日の大まかなチェックポイント化 →
   観光地や宿泊地は大まかな地域からの検索で具体化する。検索時にも AI 補助を使う
4. **プランと実績（GPS トラック）の対応付けは今回のスコープ外**
   （チェックポイント到着判定・予実比較は次のタスク）
5. AI 呼び出しは **web の API route に集約**（Claude / ChatGPT の 2 プロバイダ、
   キーはサーバ側のみ）。iOS もサーバ経由で呼ぶ
6. 日別グルーピングは **trip_days テーブルを新設**し、チェックポイントは trip_day に紐付ける
7. **移動手段（transport）は旅行単位で持つ**（AI 行程提案の入力に使う）
8. 地点検索は **iOS = MapKit Local Search / Web = Nominatim (OSM)**。
   Nominatim は利用規約に従いサーバ経由プロキシ（User-Agent 明示・キャッシュ・レート制限）
9. **AI モデルは候補を絞り、Web の設定画面から変更可能にする**（後述）

## 対応方針

### データモデル（`web/src/lib/db.ts` MIGRATIONS に追加が正）

```sql
-- migration 2（案）
-- trips: 旅行への昇格
--   started_at を nullable 化（プラン段階では未出発）→ SQLite のためテーブル再作成方式
--   transport: car / train / walk / bicycle / mixed など（nullable）
--   deleted_at: tombstone（双方向同期の削除伝搬用）
alter table trips ...;  -- 再作成マイグレーション

create table trip_days (
  id text primary key,
  trip_id text not null references trips (id) on delete cascade,
  date text not null,            -- YYYY-MM-DD
  title text,                    -- 大まかな行程（例: 松本周辺を観光して泊）
  note text,
  updated_at text not null,
  deleted_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index trip_days_trip_date_idx on trip_days (trip_id, date);

create table checkpoints (
  id text primary key,
  trip_id text not null references trips (id) on delete cascade,
  trip_day_id text not null references trip_days (id) on delete cascade,
  type text not null check (type in
    ('departure', 'destination', 'sightseeing', 'cafe', 'restaurant', 'lodging', 'other')),
  name text not null,
  latitude real,                 -- 地域だけ決まっていて座標未定なら null
  longitude real,
  planned_time text,             -- ISO8601 任意（ミーティングで立ち寄るカフェ等）
  note text,
  sort_order integer not null default 0,
  updated_at text not null,
  deleted_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index checkpoints_day_order_idx on checkpoints (trip_day_id, sort_order);

-- サーバ側のみの設定（同期対象外）。AI モデル選択などを key-value で保持
create table app_settings (
  key text primary key,
  value text not null,
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

- 出発地は 1 日目の `type = 'departure'`、到着予定地は最終日の `type = 'destination'` の
  チェックポイントとして表現する（trips にカラムを増やさず、地図表示・編集も統一的に扱う）
- 旅行の状態は導出とする: `started_at == null` → プラン中 / `ended_at == null` → 進行中 /
  それ以外 → 終了。status カラムは持たない（同期の競合対象を減らす）
- 旅の途中の日付追加・削除は trip_days 行の追加・削除（tombstone）。
  途中に 1 日挿入して以降を後ろへずらす操作は、後続 trip_days の date 更新として扱う
- iOS 側は `TripDayEntity` / `CheckpointEntity` を `Entities.swift` に追加し、
  `Models.swift` / `SyncRecords.swift` にも対応する型を定義する

### 旅行ライフサイクルの変更（iOS）

- **記録停止 ≠ 旅行終了**にする。旅行詳細で記録の開始/停止を何度でも行え、
  「旅行を終了」は明示的な別操作（ended_at を設定）
- 旅行はプラン段階（未出発）でも作成できる。記録開始時は「進行中 or プラン中の旅行に追記」する
- 地図描画は iOS (MapKit) / Web (MapLibre) とも、点列を時間ギャップ閾値
  （案: 10 分。実装時に調整）で区間分割し、区間ごとにポリラインを分けて描く
  （GPS 切断・記録停止中を線で結ばない）

### 双方向同期（プラン系のみ）

- **競合解決は行単位の LWW**（`updated_at` の新しい方が勝つ）、**削除は tombstone**
  （`deleted_at` を立てて同期、物理削除しない）。単一ユーザーなのでこれで十分
- `updated_at` は**クライアントが編集時刻を設定して送る**よう変更する
  （現在はサーバが打刻。LWW の基準を編集時刻に揃えるため）
- **POST /api/sync 拡張**: `trips` に新カラム、`days` / `checkpoints` 配列を追加。
  upsert を `ON CONFLICT DO UPDATE ... WHERE excluded.updated_at > updated_at` に変更
- **GET /api/sync/pull（新設）**: `?since=<ISO8601>` で `updated_at > since` の
  trips / trip_days / checkpoints（tombstone 含む）と `serverTime` を返す。
  iOS は起動時・フォアグラウンド復帰時・編集後に pull し、LWW でローカルへ反映。
  最後に受け取った `serverTime` を次回の since に使う
- Web 側の編集はブラウザに Bearer を置けないため **Next.js Server Actions** で行う
  （ページと同じ保護範囲 = 本番は Cloudflare Access。`/api/*` の Bearer 規約は変えない）

### AI 提案・検索補助

- ロジックは `web/src/lib/ai.ts`（仮）に置き、iOS 向けは `/api/ai/*`（Bearer）、
  Web 向けは Server Action から同じ関数を直接呼ぶ
- **POST /api/ai/plan**: 入力 = 出発地・到着予定地・開始日・日数・移動手段・要望（自由記述）。
  出力 = 日別の大まかな行程（date / title / 地域 / チェックポイント候補）。
  クライアントで内容を確認・編集してから trip_days / checkpoints として採用する
- **POST /api/ai/search-assist**: 検索補助。大まかな地域 + 種別（宿・観光地など）+
  自由記述から、検索クエリ候補や具体的な地点候補を返す
- プロバイダは Claude (Anthropic API) と ChatGPT (OpenAI API) の 2 系統。
  それぞれ公式 SDK を使い、`web/src/lib/ai.ts` の共通インターフェースの背後に隠す
  （構造化出力は Claude = tool use / ChatGPT = Responses API の structured outputs）。
  `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` を web の env に追加
  （`.env.example` / deploy-g3plus.md / g3plus-ops 側の追従が必要）

#### AI モデルの選択（Web 設定画面）

- 候補は以下の 4 つに絞り、`web/src/lib/ai.ts` に許可リスト
  （provider + モデル ID + 表示名）として定義する
  （価格は 2026-08 時点の $/1M トークン 入力/出力。実装時に再確認する）:

  | モデル | provider / ID | 価格 | 位置付け |
  |---|---|---|---|
  | Claude Opus 5 | anthropic / `claude-opus-5` | $5 / $25 | 既定。行程提案の品質重視 |
  | Claude Sonnet 5 | anthropic / `claude-sonnet-5` | $3 / $15（2026-08-31 まで $2 / $10） | バランス |
  | GPT-5.6 Sol | openai / `gpt-5.6-sol` | $5 / $30 | ChatGPT 側の品質重視 |
  | GPT-5.6 Terra | openai / `gpt-5.6-terra` | $2 / $12（2026-07-30 値下げ後） | ChatGPT 側のバランス |

- 選択値はサーバの DB に保持する。`app_settings` テーブル（key-value）を新設し、
  `ai_model` キーにモデル ID を保存（provider は許可リストから引く）。**同期対象外**
  （AI 呼び出しはすべてサーバ側なので iOS に配る必要がなく、
  iOS からの `/api/ai/*` 呼び出しにも自動で適用される）
- Web に設定ページ `/settings` を追加し、Server Action で変更する
  （ページと同じ保護範囲。許可リスト外の値は拒否）
- まずはプラン提案・検索補助で共通の 1 設定とする（用途別に分ける必要が出たら
  キーを増やす）。推論設定は Claude = adaptive thinking（Opus 5 / Sonnet 5 の既定）、
  ChatGPT = Responses API の既定 reasoning を使う

### 地点検索

- iOS: `MKLocalSearch`（キー不要）。検索結果からチェックポイント登録
- Web: Nominatim をサーバ経由でプロキシ（Server Action）。
  User-Agent 明示・結果キャッシュ・1 req/s のレート制限を実装（Nominatim 利用規約）

### UI（概要）

- iOS: 旅行作成（タイトル・移動手段・開始日・日数）→ 日別リスト（trip_days）→
  各日のチェックポイント一覧・追加（検索 / AI）・編集・並べ替え・削除。
  地図にチェックポイントをピン表示
- Web: 旅行詳細に日別プラン表示 + 編集（チェックポイント CRUD・Nominatim 検索・AI 提案）

## 影響範囲

- web: `db.ts`（migration）、`/api/sync`、`/api/sync/pull`（新設）、`/api/ai/*`（新設）、
  Server Actions、旅行詳細ページ、地図描画（区間分割）、設定ページ `/settings`（新設）
- iOS: `Entities.swift` / `Models.swift` / `SyncRecords.swift`、`SyncClient`（pull 対応）、
  記録ライフサイクル、プラン UI 一式、地図描画（区間分割）。
  ファイル追加後は `xcodegen generate` 再実行
- docs: `server-api.md`（sync 拡張 / pull / ai）、`deploy-g3plus.md`（ANTHROPIC_API_KEY）、
  g3plus-ops 側の env 追従
- 既存データ: trips のテーブル再作成マイグレーションあり（データ移行はカラム追加のみで無損失）

## テスト方針

- web: `npm run lint` / `npm run build`。sync の LWW / tombstone は
  route handler をユニットテストで検証（一時 DB ファイルを使う）
- iOS: unmanaged エンティティでのユニットテスト（CLAUDE.md の注意に従いコンテナ未挿入で書く）。
  pull 反映の LWW ロジック、日付グルーピング、ギャップ区間分割ロジックをテスト
- AI 部分はプロンプト・スキーマ検証を中心に（実 API 呼び出しのテストは手動確認）

## Phase 4 実装メモ（iOS プラン UI）

- **旅行作成** `TripCreateView`: タイトル・移動手段（`Transport` enum を Models に追加）・
  開始日・日数のフォーム。`PlanEditor.makeTrip` で trip + trip_days を作り挿入
  （startedAt は nil のまま = プラン中）。一覧のツールバー「+」から開く
- **旅行編集** `TripEditView`: タイトル・移動手段のみ（開始/終了は記録ライフサイクル側）
- **日別リスト**: `TripDetailView` に「プラン」セクションを追加（n日目・日付・タイトル・
  CP 件数）。「日を追加」は最終日の翌日を追加（日が無ければ startedAt ?? 今日）
- **日詳細** `TripDayDetailView`: タイトル・メモ編集（シート）、チェックポイントの
  追加（検索 / 手入力）・編集・並べ替え（EditButton + onMove）・スワイプ削除。
  日の削除は tombstone で、ぶら下がるチェックポイントも道連れにする
- **検索** `CheckpointSearchView`: MKLocalSearch。旅行内の既存座標（CP・記録点）が
  あればその周辺を region ヒントにする。検索結果の選択で即追加
  （種別は POI カテゴリから推測。修正は行タップ → 編集フォームで）
- **編集フォーム** `CheckpointEditView`: 種別・名前・予定時刻（トグルで任意）・メモ・
  位置（検索で設定 / クリア可。座標なし = 地域だけ決定も許容）
- **地図ピン**: `TripMapView` に checkpointAnnotations を追加し、種別ごとの
  アイコン・色（`CheckpointStyle.swift`）の Marker で表示
- 編集系の保存時は必ず `updatedAt = now` + `needsSync = true`（LWW の基準）とし、
  保存後に `sync.syncNow()` を投げる
- 純ロジックは `PlanEditor` に寄せ、unmanaged エンティティでユニットテストする

## Phase 5 実装メモ（Web プラン UI）

- **編集ロジック** `web/src/lib/plan.ts`: 日の追加（最終日の翌日。無ければ started_at ?? 今日）、
  日の更新・削除（tombstone + チェックポイント道連れ）、CP の CRUD・↑↓入れ替え。
  変更した行だけ `updated_at = now`（LWW の基準。iOS の PlanEditor と同じ方針）。
  ユニットテストは `web/test/plan.test.ts`（sync.test.ts と同じ一時 DB 方式）
- **Server Actions** `web/src/app/trips/[id]/actions.ts`: lib/plan を呼んで
  `revalidatePath` するだけの薄い層。ページと同じ保護範囲（本番は Cloudflare Access）で
  Bearer は使わない。エラーは `{ ok: false, error }` で返して UI に表示
- **Nominatim プロキシ** `web/src/lib/nominatim.ts`: `searchPlaces()` を Server Action 経由で
  呼ぶ。利用規約対応 = User-Agent 明示・プロセス内で 1 req/s に直列化・
  結果を 24h / 200 件までメモリキャッシュ。`guessCheckpointType()` で
  category/type から種別を推測（tourism→観光/宿泊、amenity→カフェ/食事 など）
- **UI** `plan-section.tsx`（日別カード・CP 行・↑↓・二段階削除）+
  `place-search.tsx`（検索。即追加とフォーム内の位置設定で共用）+
  `checkpoint-form.tsx`（手入力追加・編集の共通フォーム）。
  種別の表示定義は `web/src/lib/checkpoint-style.ts`（iOS の CheckpointStyle と対応）
- **地図** `trip-map.tsx` に checkpoints プロップを追加（種別色のピン + クリックで名前）。
  記録点が無くても CP に座標があれば地図を表示する
- 予定時刻の入力・表示はブラウザのローカル TZ（iOS と同じ端末基準。
  行表示は SSR とずれ得るので suppressHydrationWarning）。
  trip_days.date は日付のみなので UTC で整形し TZ の影響を受けない

## Phase 分割

- **Phase 1: 旅行の再定義** — trips migration（started_at nullable / transport / deleted_at）、
  iOS の記録停止 ≠ 旅行終了、ギャップ区間分け描画（iOS / Web）
- **Phase 2: プランのデータモデル** — trip_days / checkpoints（web migration + iOS エンティティ + 型）、
  server-api.md 更新
- **Phase 3: 双方向同期** — /api/sync 拡張、/api/sync/pull 新設、LWW + tombstone、
  iOS SyncClient の pull 対応
- **Phase 4: iOS プラン UI** — 旅行作成・日別リスト・チェックポイント CRUD・MapKit 検索・地図ピン
- **Phase 5: Web プラン UI** — Server Actions、日別表示・編集、Nominatim プロキシ検索
- **Phase 6: AI 提案・検索補助** — /api/ai/plan、/api/ai/search-assist、iOS / Web の導線、
  Web 設定画面（AI モデル選択、app_settings）、env 追加とデプロイ（g3plus-ops 追従）
