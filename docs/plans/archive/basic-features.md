# 基本機能を詰める 実装プラン

## 目的・背景

trip-note は旅行のサポートをするアプリで、モバイルと Web の両方で使うことを想定している。
基本機能(位置情報の記録・閲覧、地図表示、写真/動画撮影)を実現するための技術選定からスキャフォールド、各機能の実装までを段階的に進める。

対象となる基本機能:

- モバイルアプリで位置情報を保存する
- 保存したデータをモバイルアプリと Web 画面の両方で見られる
- 地図表示
- 写真撮影と動画撮影

> **2026-08-21 方針転換**: 当初 Expo (React Native) でスキャフォールドまで実施したが、「Expo は使わずネイティブで作る」方針に変更。iOS (Swift/SwiftUI) 先行・Web は Next.js・バックエンドは Supabase 継続で確定し、Expo 構成は撤去した。Android (Kotlin) は基本機能完成後の後続タスクとする。

> **2026-08-21 方針転換(2)**: バックエンドを Supabase から**自宅サーバ (g3plus)** に全面移行([plan](g3plus-backend.md))。Web の Next.js が API(`/api/sync`)と閲覧 UI を兼ね、DB は SQLite。認証はアプリ内から撤去し、iOS API は共有シークレット Bearer・Web は Cloudflare Access(エッジ)で保護する。Phase 2 の Supabase 実装は [phase2-supabase-sync.md](../specs/phase2-supabase-sync.md)(superseded)に記録。現行仕様は [server-api.md](../specs/server-api.md) / [deploy-g3plus.md](../specs/deploy-g3plus.md)。

## 対応方針

### 技術スタック(確定)

| 領域         | 採用                                                | 理由                                                                                             |
| ------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| モバイル     | iOS ネイティブ (Swift / SwiftUI)                    | ネイティブ方針。iOS を先行し、Android (Kotlin) は後続タスク                                      |
| プロジェクト生成 | XcodeGen (`ios/project.yml`)                    | .xcodeproj を生成物としてコミット対象から外し、差分レビュー可能な YAML で管理する                |
| Web          | Next.js (React + TypeScript)                        | 地図(MapLibre)・メディア表示のエコシステムが充実。デプロイも容易                                 |
| バックエンド | Supabase (Postgres + Auth + Storage)                | 位置情報は Postgres、写真/動画は Storage、認証も一括。supabase-swift / supabase-js の公式 SDK    |
| 地図         | iOS: MapKit / Web: MapLibre GL JS                   | iOS はネイティブなら MapKit が最有力(追加依存なし)。Web は MapLibre                              |
| リポジトリ構成 | `ios/`(Xcode プロジェクト) + `web/`(Next.js)      | プラットフォームごとに独立。データモデルは Supabase スキーマを正とし、各言語で型を定義する       |

### データモデル(初期案)

- `trips`: 旅行単位のグルーピング(title, started_at, ended_at)
- `location_points`: 位置情報(trip_id, lat, lng, altitude, accuracy, recorded_at)
- `media`: 写真・動画(trip_id, location_point_id?, type: photo/video, storage_path, taken_at)

Swift / TypeScript 双方に同じモデルを定義する。スキーマは `supabase/` 以下のマイグレーション SQL を正とする(Phase 1 で作成)。

### Phase 構成

#### Phase 0: 技術選定・スキャフォールド(ネイティブ版でやり直し) ✅ (2026-08-21 完了)

- [x] Expo 構成(`apps/`, `packages/`, ルート npm workspace)の撤去
- [x] `ios/`: XcodeGen で SwiftUI アプリ(TripNote)を作成。ユニットテストターゲット + サンプルテスト(Geo 計算 4 件)込み。supabase-swift を SPM で導入
- [x] `web/`: create-next-app で Next.js (TypeScript + Tailwind + App Router) を作成
- [x] 検証: iOS シミュレータビルド + `xcodebuild test`(4/4 passed)、Web の lint + `next build` すべて成功
- [x] CLAUDE.md のアーキテクチャ・コマンドをネイティブ構成に書き換え
- [ ] 残タスク(要ユーザー操作): Supabase プロジェクト作成(https://supabase.com/dashboard)。`web/.env.example` を元に `web/.env.local` を設定。Phase 1 の同期実装までに必要

#### Phase 1: 位置情報の記録(iOS・バックグラウンド対応)

**要件**: 画面 OFF・アプリがバックグラウンドや終了状態でも、旅行(記録セッション)中は可能な限り移動経路を記録する。

- [x] 記録方式: CLLocationManager の標準位置更新 + Background Modes (`location`) — `Services/LocationRecorder.swift`
  - `allowsBackgroundLocationUpdates = true` / `pausesLocationUpdatesAutomatically = false` / `showsBackgroundLocationIndicator = true`
  - `desiredAccuracy = best` / `distanceFilter = 10m` / `activityType = .otherNavigation`
- [x] 権限: When In Use → Always の 2 段階リクエスト(When In Use 取得後に Always 昇格を要求)
  - Always 許可時: アプリがシステムに終了されても significant location change で再起動され記録を再開できる
  - When In Use のみ: 記録中のバックグラウンド継続は可能(青インジケータ表示)。強制終了後の自動再開は不可
- [x] 再開処理: App 起動時(`TripNoteApp.init`)に「終了していない trip」があれば記録を自動再開(バックグラウンド再起動時は UI 表示なしで動く)
- [x] ローカル保存: SwiftData(TripEntity / LocationPointEntity, cascade delete)
- [x] ノイズ除去: 水平精度 50m 超・負値は破棄、直前記録点から 5m 未満は間引き、時刻逆行は破棄(`Domain/LocationPointFilter.swift`、ユニットテスト 7 件)
- [x] UI: 記録開始 / 停止、記録中ステータス(点数・総距離)、権限拒否時の設定アプリ誘導、trip 一覧
- [x] `xcodebuild test` 11/11 passed(2026-08-21)
- [x] 実機実行環境の整備: `./run-ios-device.sh`(vocab-blossom と同方式。DEVELOPMENT_TEAM 差し込み + devicectl でインストール・起動)。実機向けビルド・署名成功を確認済み(2026-08-21)
- [x] 実機での動作確認(`run-ios-device.sh` でインストール〜起動を確認 2026-08-21)

バッテリーとのトレードオフは `distanceFilter` / `desiredAccuracy` で調整する。省電力モードや圏外時は取得間隔が粗くなるため「可能な限り」の記録とする。

#### Phase 2: Supabase 同期と記録の閲覧(iOS・Web)

詳細仕様: [docs/specs/phase2-supabase-sync.md](../specs/phase2-supabase-sync.md)

- [x] `supabase/` にスキーマ(マイグレーション SQL + RLS)を作成。セットアップ手順は `supabase/README.md`
- [x] iOS: ローカル記録の Supabase への同期 — `Services/SyncEngine.swift`
  - `needsSync` フラグをアップロードキューとして扱い、trip → 位置情報(500 件ずつ)の順に upsert で冪等に送る
  - 記録中はローカル優先: 自動同期(フォアグラウンド復帰時)は記録中はスキップ。記録停止時と手動同期はいつでも可
- [x] iOS: 認証(メール+パスワード) — `Services/SupabaseService.swift` + `Views/AuthView.swift`。接続情報は `Resources/Supabase.plist`(gitignore 済み、雛形は `Supabase.example.plist`)
- [x] iOS: 閲覧画面 — trip 一覧から `Views/TripDetailView.swift`(統計 + 位置情報のタイムライン)へ遷移
- [x] Web: Next.js + supabase-js + @supabase/ssr で認証込みの閲覧画面(`/login`, `/`, `/trips/[id]`)。Next.js 16 のため middleware ではなく `src/proxy.ts` を使用
- [x] 検証: `xcodebuild test` 16/16 passed、`npm run lint` + `npm run build` 成功(2026-08-21)
- [ ] 残タスク(要ユーザー操作): Supabase プロジェクトを作成し、`supabase/README.md` の手順でスキーマ適用と接続設定を行った上で、実機・ブラウザで同期と閲覧を確認する

既知の注意点: テストのホストアプリが同じ @Model クラスで ModelContainer を作成しているため、テスト側で 2 つ目のコンテナを作って insert すると SwiftData がクラッシュする。ユニットテストは unmanaged なエンティティで書く(`TripNoteTests/SyncRecordTests.swift` のコメント参照)。

#### Phase 3: 地図表示

詳細仕様: [docs/specs/phase3-map-display.md](../specs/phase3-map-display.md)

- [x] iOS: MapKit で trip 詳細に軌跡を表示 — `Views/TripMapView.swift`(SwiftUI `Map` + `MapPolyline`、開始/最新マーカー、カメラは `.automatic`)
- [x] Web: MapLibre GL JS で同等の表示 — `web/src/app/trips/[id]/trip-map.tsx`(GeoJSON LineString + fitBounds)。タイルは当面 OSM 公式ラスタタイル(本番向け差し替えは TODO に記載)
- [x] 検証: `xcodebuild test` 16/16 passed、`npm run lint` + `npm run build` 成功(2026-08-21)
- [x] iOS: 実データ(シミュレート GPS)での地図表示を UI テストで確認(2026-08-21)
  - `TripNoteUITests` スキームの `RecordingMapUITests` で記録開始 → 移動 → 停止 → 詳細の地図表示までを通しで実行(手順は spec 参照)。スクリーンショット: `docs/screenshots/phase3-ios-map-simulator.png`
- [ ] 残タスク(要ユーザー操作): Web の実データでの見た目確認(Supabase セットアップ後、Phase 2 の手動確認と合わせて実施)

個々の位置情報のドット表示は数千点になり得るため行わず、ポリライン + 開始/最新マーカーのみとした。点の詳細は既存のタイムラインで確認する。

#### Phase 4: 写真撮影と動画撮影

詳細仕様: [docs/specs/phase4-media.md](../specs/phase4-media.md)(Supabase Storage 前提は g3plus 構成に置き換え)

- [x] iOS: 撮影・取り込みとローカル保存(MediaEntity / MediaStore、システムカメラ + PhotosPicker、位置・時刻の紐付け)。写真は JPEG 2560px、動画は H.264 mp4 720p に圧縮、サムネイル生成
- [x] Web: メディア API(`POST /api/media` アップロード、`GET /media/[id]` 配信・Range 対応)
- [x] iOS: 同期(SyncEngine の trips → points → media 順のアップロード。1 件ずつ確定)
- [x] 閲覧: iOS / Web の詳細画面にメディアグリッド + フルスクリーンビューア、地図にサムネイルマーカー
- [x] 検証: iOS ユニットテスト 24 件、Web lint/build + curl、シミュレータ E2E(取り込み → 同期 → Web 表示。`TripNoteUITests/MediaImportUITests`)すべて成功(2026-08-21)
- [x] 本番デプロイ(2026-08-21。git pull → rebuild、compose 変更なし。疎通確認: /api/sync 401/200・/api/media 401/400・/media/[id] Access 302)
- [x] 実機でカメラ撮影(写真・動画)→ 本番同期 → 保存・配信・表示を確認(2026-08-21。jpg 1920x2560 / mp4 720p、location_point 紐付き、Range 206)

## 影響範囲

- 既存の Expo スキャフォールド(`apps/`, `packages/`, ルート package.json)は削除する
- 追加されるもの: `ios/` 以下(project.yml + Swift ソース)、`web/` 以下(Next.js)、`supabase/`(Phase 1〜)、CLAUDE.md の書き換え
- 外部サービス: Supabase プロジェクト(無料枠から開始)、地図タイル(MapLibre + タイルソース選定は Phase 3)

## テスト方針

- iOS: ドメインロジック(Geo 計算・同期ロジックなど)を XCTest / Swift Testing でユニットテスト。`xcodebuild test` で実行。UI・位置情報・カメラは実機/シミュレータでの手動確認手順を各 Phase の完了条件に含める
- Web: ESLint + `next build` を最低ライン、ロジックが増えた時点で Vitest を導入(Phase 2 で判断)
- 各 Phase の完了条件に「シミュレータ / ブラウザでの動作確認」を含める

## 備考

- Android (Kotlin) 版、バックグラウンド位置記録、共有機能、オフライン完全対応は基本機能完成後の後続タスク
- 各 Phase 着手時に、必要に応じて `docs/specs/` に詳細仕様を切り出す
