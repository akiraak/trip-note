# DONE - 完了済みタスク

## 2026-08-22

- アイコンの設定 [plan](docs/plans/archive/app-icon.md)
  - iOS: Assets.xcassets の AppIcon(1024 single-size)+ project.yml に ASSETCATALOG_COMPILER_APPICON_NAME
  - Web: favicon.ico(16/32/48 マルチサイズ・RGBA)/ icon.png(512)/ apple-icon.png(180)
  - 元画像は docs/assets/app-icon-original.png に保存。検証: iOS シミュレータビルド + web build

## 2026-08-21

- 旅行の削除 [plan](docs/plans/archive/trip-delete.md)
  - tombstone 削除(既存の双方向同期に乗る)。未削除の日・チェックポイントも道連れ、points / media は行を残す(親の tombstone で非表示)
  - iOS: TripDetailView に「旅行を削除」+ 確認ダイアログ(記録中なら停止してから)。Web: 旅行詳細下部に二段階削除 → 一覧へ
  - 検証: web vitest 59 件 + lint + build、iOS ユニットテスト 82 件

- AI 日数・宿泊地候補の長距離移動対応 [plan](docs/plans/archive/trip-outline-long-distance.md)
  - プロンプトを「出発地から目的地へ向かう行程」前提に書き換え(離れていれば経路上の中継地で宿泊。車は 1 日 400〜600km 目安)
  - 現在地の地名に市区町村名を前置(番地だけで都市が伝わらない問題)、出発地の座標も AI 入力に追加
  - 検証: web vitest 57 件 + lint + build、iOS ユニットテスト 81 件

- 旅行作成に出発地を追加(現在地から設定可能) [plan](docs/plans/archive/trip-create-departure-place.md)
  - 出発地は 1 日目の departure チェックポイントとして保存(planned_time = 出発日時。DB・同期の変更なし)
  - 「現在地」ボタン: OneShotLocationProvider(一回きりの位置取得 + 逆ジオコーディングで地名化)。自動入力名を編集したら座標は使わない
  - /api/ai/trip-outline の入力に departure(任意)を追加してプロンプトに反映、AIPlanSuggestView の出発地初期値にも使用
  - 検証: web vitest 55 件 + lint + build、iOS ユニットテスト 78 件 + シミュレータビルド。現在地取得の実機/シミュレータでの手動確認は未実施

- 旅行作成フローの変更(出発日時・目的地 + AI 日数・宿泊地候補) [plan](docs/plans/archive/trip-create-departure-destination.md)
  - Phase 1: trips に departure_at / destination を追加(web migration 5・sync/pull・iOS Entity/Record/PlanPull)
  - Phase 2: iOS 旅行作成フォームの変更(開始日 → 出発日時、日数入力を廃止して 1 日目のみ作成、目的地を追加。編集/詳細画面も追従)
  - Phase 3: AI 日数・宿泊地候補 API(lib/ai.ts + /api/ai/trip-outline)
  - Phase 4: iOS 候補出し UI(作成フロー 2 ステップ化・候補選択で trip_days + lodging CP を採用)
  - Phase 5: Web 旅行詳細に出発予定・目的地を表示、server-api.md 追従
  - 検証: web vitest 55 件 + lint + build、iOS ユニットテスト 76 件 + シミュレータビルド。実 AI 呼び出し(trip-outline)の手動確認と本番反映(push → サーバ pull → rebuild)は未実施

- 「1つの旅行」の定義とプラン機能 [plan](docs/plans/archive/trip-definition-and-planning.md)
  - Phase 1: 旅行の再定義(記録停止≠旅行終了・GPS ギャップの区間分け描画・trips migration)
  - Phase 2: プランのデータモデル(trip_days / checkpoints、iOS エンティティ・型)
  - Phase 3: 双方向同期(/api/sync 拡張・/api/sync/pull 新設・LWW + tombstone)
  - Phase 4: iOS プラン UI(旅行作成・日別リスト・CP CRUD・MapKit 検索)
  - Phase 5: Web プラン UI(Server Actions・日別編集・Nominatim 検索)
  - Phase 6: AI 提案・検索補助(/api/ai/plan・/api/ai/search-assist、Claude/ChatGPT の 2 プロバイダ、Web /settings でモデル選択〔app_settings〕、iOS/Web の提案採用・検索補助導線、env 追加と g3plus-ops 追従)
    - 検証: web vitest 46 件 + lint + build、iOS ユニットテスト 68 件 + シミュレータビルド。本番反映(push → サーバ pull → rebuild + .env に AI キー追加)と実 AI 呼び出しの手動確認は未実施

- Web の地図タイルを本番向けに差し替える [plan](docs/plans/archive/web-map-tiles-production.md)
  - OSM 公式ラスタタイル → OpenFreeMap ベクタタイル（Liberty スタイル。登録・API キー不要で本番利用可、帰属表記はスタイル側に含まれる）
  - 検証: lint / build、ローカルでタイル描画・軌跡・マーカー・帰属表記を目視確認

- 基本機能を詰める [plan](docs/plans/archive/basic-features.md)
  - Phase 0: 技術選定・スキャフォールド（ネイティブ構成: iOS Swift/SwiftUI + Next.js。バックエンドは Supabase で開始し途中で自宅サーバ g3plus に全面移行）
  - Phase 1: 位置情報の記録（画面 OFF・バックグラウンド対応、SwiftData ローカル保存）
  - Phase 2: 同期と記録の閲覧（needsSync キューで trips → points をアップロード） [spec](docs/specs/server-api.md)
  - Phase 3: 地図表示（iOS: MapKit / Web: MapLibre GL JS） [spec](docs/specs/phase3-map-display.md)
  - Phase 4: 写真撮影と動画撮影 [spec](docs/specs/phase4-media.md) — カメラ撮影 + ライブラリ取り込み、写真 JPEG 2560px / 動画 H.264 mp4 720p に圧縮、撮影時刻に最も近い記録点へ紐付け、`POST /api/media` で同期、iOS / Web の詳細画面グリッド + 地図サムネイルマーカーで閲覧
    - 検証: iOS ユニットテスト 24 件・Web lint/build・API curl 全ケース・シミュレータ E2E、本番デプロイ + 疎通確認、実機で写真・動画を撮影 → 本番同期 → 保存（jpg 1920x2560 / mp4 3.4MB）・配信（Range 206）・ページ表示まで確認

- 実機で本番同期を動作確認
  - iPhone 14 Pro で記録（4 地点・31m）→ 停止時の自動同期で本番サーバに反映されることを確認。サーバ側 DB の値（4 点・総距離 31.3m・精度 ±2〜5m）がアプリ表示と一致

- バックエンドを Supabase から自宅サーバ (g3plus) に入れ替える [plan](docs/plans/archive/g3plus-backend.md)
  - Web: Next.js が API（`/api/sync`、`API_SHARED_SECRET` の Bearer）と閲覧 UI を兼ねる構成に変更。DB は SQLite（better-sqlite3）。アプリ内認証・/login・proxy.ts を撤去
  - iOS: supabase-swift を撤去し `SyncClient` + `ServerConfig.plist` に置き換え（needsSync キュー・500 件バッチ・upsert 冪等は維持）
  - ローカル E2E（シミュレータで記録 → 停止時自動同期 → Web の一覧・詳細・地図表示）で検証。maplibre-gl が Turbopack 下でワーカーを解決できないバグも発見・修正
  - 本番デプロイ（g3plus、port 3011・ホスト非公開）+ Cloudflare 設定（`trip.chobi.me`。Access: ルート Google 認証 + `/api` Bypass）+ 本番疎通確認（Bearer 401/200・閲覧 UI が Access 302）+ iOS の ServerConfig.plist 本番切替まで完了
