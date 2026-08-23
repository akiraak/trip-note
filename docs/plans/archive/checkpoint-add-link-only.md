# チェックポイント検索を Google Maps の共有とリンク貼り付けだけにする

## 目的・背景

チェックポイントを探す入口はこれまで段階的に増えてきた:

1. 地名の自由語検索(iOS `MKLocalSearch` / Web Nominatim)
   + その日の経路を範囲ヒントに([checkpoint-search-day-route](archive/checkpoint-search-day-route.md))
2. AI 検索補助(`POST /api/ai/search-assist`。地域 + 要望 → クエリ候補・地点候補)
3. 「観光地」のカテゴリ検索(`POST /api/places/nearby` = Overpass プロキシ、
   [checkpoint-nearby-sightseeing](archive/checkpoint-nearby-sightseeing.md))
4. Google Maps の共有シート「旅ログ」/ 検索欄へのリンク貼り付け(`POST /api/places/resolve-link`、
   [google-maps-share-import](archive/google-maps-share-import.md))

実際に使うのは 4(場所は Google Maps で探し、共有かリンク貼り付けで旅ログに入れる)に
集約されたので、**1〜3 を全て削除し、チェックポイントの追加経路を「Google Maps の共有」と
「Google Maps のリンクの直接入力」の 2 つだけにする**。検索欄・AI 欄・カテゴリ語・
経路ヒントなど、それ以外の仕組みは UI・API・ライブラリ・テスト・ドキュメントまで含めて消す。

### 残すもの / 消すものの線引き

| 区分 | 内容 |
| --- | --- |
| **残す** | iOS Share Extension(`TripNoteShare`)/ App Group 受信箱 `ShareInbox` / 取り込みシート `SharedPlaceImportView` / URL スキーム `tripnote://share` |
| **残す** | リンク解決 `POST /api/places/resolve-link` + Server Action `resolveGoogleMapsLinkAction` + `lib/google-maps-share.ts`(短縮リンク展開・URL パース) |
| **残す** | `lib/nominatim.ts` の**ジオコーダとしての役割のみ**(iOS アプリの共有リンクは座標を含まないため `resolve-link` が「名前 + 住所」を Nominatim で引く補完。これはリンク解決の内部処理であり、ユーザーが操作する「検索」ではない) |
| **残す** | iOS / Web の「リンクを貼る」入力欄(現在の検索欄を、リンク専用の入力欄に作り替える) |
| **残す(対象外)** | AI 行程提案 `/api/ai/plan` / `/api/ai/trip-outline` / `/api/ai/jobs`、`/settings` のモデル選択。「検索」ではないので本タスクでは触らない(文言だけ「検索補助」を外す) |
| **残す(対象外)** | 旅ログ → Google Maps 方向のリンク(`Domain/GoogleMapsLink.swift` / `lib/google-maps.ts`) |
| **消す** | 自由語検索: iOS `MKLocalSearch`(`CheckpointSearchView.search` の MapKit 経路・`suggestedType(for:)`・`regionHint`)、Web `searchPlacesAction` と Nominatim 結果一覧 |
| **消す** | AI 検索補助: `POST /api/ai/search-assist`、`lib/ai.ts` の search-assist 部分、Web `search-assist.tsx`、iOS `assistSection` / `AIClient.searchAssist` / `AIRecords` の search-assist DTO |
| **消す** | カテゴリ検索: `POST /api/places/nearby`、`lib/overpass.ts` / `lib/category-search.ts`、iOS `Domain/CategorySearch.swift` / `Models/NearbyPlaceRecords.swift` / `AIClient.nearbyPlaces` |
| **消す** | 検索用の経路文脈: `DayRoute.searchRegion` / `DayRoute.places` / `DayRoutePlace`(iOS)、`lib/day-route.ts` 全体(Web。`dayRoute` / `searchViewbox` / `parseRouteInput` の利用者は検索だけ)、`PlaceSearch` / `CheckpointForm` / `DayCard` の `route` prop |
| **消す** | 「リンクから座標が取れなかったら名前で検索」のフォールバック(iOS / Web / 取り込みシートの「検索で位置を決める」)。自由語検索が無くなるので成立しない |

## 対応方針

### 共通仕様(リンク入力欄の挙動)

- 入力欄は **Google Maps のリンク(共有テキストごと貼ってもよい)専用**。プレースホルダは
  「Google Maps のリンクを貼る」、ボタンは「読み込む」。補足文(常時表示)は
  「Google Maps で場所を開き「共有」→「リンクをコピー」したものを貼ると、その場所を追加できます」
  (iOS は「共有シートから直接「旅ログ」を選ぶこともできます」を併記)
- 入力に Google Maps の URL が含まれなければ「Google Maps のリンクを貼ってください」と出すだけ
  (他の検索には回さない)
- 解決結果は従来どおり **1 件の結果行(名前 + 精度の説明)→「追加」** の 2 段のまま
  (名前・精度を確認してから入れる導線は残す。操作は増やさない)
- **座標が取れなかった(名前だけ)とき**:
  - 日詳細の「追加」: 結果行に「座標が取れませんでした(座標未設定のまま追加できます)」を添え、
    座標 null のチェックポイントとして追加できる(`PlaceSelection` / `Place` の座標を optional にする)。
    位置はあとから CP 編集でリンクを貼り直して設定する
  - CP 編集の「位置を設定」/ 取り込みシート: 座標が無い結果は選べず、メッセージ表示のみ
    (取り込みシートは名前だけ埋めて座標未設定で追加できる = 現状の挙動。
    「検索で位置を決める」ボタンは削除し、案内文を「座標未設定のまま追加できます。位置はあとから
    編集でリンクを貼って設定できます」に変える)
- 種別は従来どおり一律 `sightseeing`(編集で直せる)
- `resolve-link` API の契約(リクエスト / レスポンス / 名前のみでも 200)は変えない。
  サーバ側で変えるのは「クライアントが名前検索にフォールバックする」という記述だけ

### Phase 1: Web(サーバ API・ライブラリ・UI)

**削除**

- `app/api/places/nearby/route.ts`、`app/api/ai/search-assist/route.ts`
- `lib/overpass.ts`、`lib/category-search.ts`、`lib/day-route.ts`
- `app/trips/[id]/search-assist.tsx`
- `actions.ts`: `searchPlacesAction` / `nearbyPlacesAction` / `searchAssistAction` と
  `SearchResult` / `NearbyResult` / `SearchAssistResult` 型、不要になった import
- `lib/ai.ts`: `SearchAssistInput` / `SearchAssistSuggestion` / `parseSearchAssistInput` /
  `SEARCH_ASSIST_SCHEMA` / `parseSearchAssistSuggestion` / `buildSearchAssistPrompt` / `searchAssist`
  と `./day-route` の import(plan / trip-outline 側は触らない)
- `lib/nominatim.ts`: `viewbox` パラメータ(キャッシュキーからも外す)、`guessCheckpointType`、
  `Place.guessedType` / `displayName`。残すのは `resolve-link` の `Geocoder` 契約
  (`searchPlaces(query)` → `{ latitude, longitude }[]`)に必要な分だけ
- `lib/format.ts` の `formatDistance`(利用者が `place-search.tsx` だけ。`lib/geo.ts` の同名関数は別物で残す)
- テスト: `test/overpass.test.ts`、`test/category-search.test.ts`、`test/day-route.test.ts`、
  `test/ai.test.ts` の search-assist ブロック、`test/nominatim.test.ts` の viewbox ケース、
  `test/plan.test.ts` の `guessCheckpointType` ブロック

**作り替え**

- `place-search.tsx` → `place-link.tsx`(`PlaceLink`)にリネーム。`searchLink` の経路だけを残し、
  上記「共通仕様」の文言・座標なし結果の扱いにする。`onSelect` の `Place` は
  `{ name, latitude: number | null, longitude: number | null }` + 精度ラベル
- `plan-section.tsx`: `route={dayRoute(days, index)}` と `DayCard` への `route` 受け渡しを削除、
  `add-search` モード / ボタン文言を「Google Maps のリンクから追加」に。座標 null の選択は
  `createCheckpoint` に null のまま渡す
- `checkpoint-form.tsx`: `route` prop 削除、「検索して設定」→「Google Maps のリンクで設定」。
  座標なし結果は `PlaceLink` 側で選べないので変更なし
- `settings/page.tsx`: 「行程提案と検索補助で使うモデル」→「行程提案で使うモデル」
- `docs/specs/server-api.md`: search-assist / nearby の節を削除、`resolve-link` の
  「クライアントは名前で通常の検索にフォールバック」を「座標未設定のまま追加」に書き換え、
  iOS クライアント節の「search-assist のみ同期 POST」を削除
- `npm run lint` / `npm run build` / `npm test`

### Phase 2: iOS

**削除**

- `Domain/CategorySearch.swift`、`Models/NearbyPlaceRecords.swift`
- `Models/AIRecords.swift`: `AISearchAssistRequest` / `AISuggestedPlace` / `AISearchAssistSuggestion`
- `Services/AIClient.swift`: `searchAssist` / `nearbyPlaces` / `nearbyTimeout`
  (`resolveGoogleMapsLink` / `resolveLinkTimeout` と plan / outline のジョブ処理は残す)
- `Domain/DayRoute.swift`: `DayRoutePlace` / `SearchRegion` / `places(for:)` / `searchRegion(for:)`。
  **`anchor(before:in:)` は `TripDetailView.routeAnchor`(経路描画)が使うので残す**
- テスト: `CategorySearchTests` / `NearbyPlaceRecordsTests`、`DayRouteTests` の searchRegion ケース、
  `AIRecordsTests` の search-assist ケース

**作り替え**

- `Views/CheckpointSearchView.swift` → `Views/GoogleMapsLinkView.swift`(`GoogleMapsLinkView`)に
  リネーム。`MapKit` の import・`region` / `route` / `regionHint` / `searchRegion` /
  `suggestedType(for:)` / `assistSection` / `searchNearby` / MKLocalSearch を削除し、
  `searchLink` の経路と `initialQuery`(取り込みシートからの初期値は不要になるので削除)を整理。
  `PlaceSelection` の座標を optional にし、呼び出し側が座標なしを許可するか
  (`allowsMissingCoordinate`)を渡せるようにする。ナビゲーションタイトルは「Google Maps のリンクから追加」
- `Views/TripDayDetailView.swift`: sheet の呼び出しを新ビューに。「検索して追加」→
  「Google Maps のリンクから追加」。座標なしは `PlanEditor.makeCheckpoint` に nil で渡す
- `Views/CheckpointEditView.swift`: sheet を新ビュー(座標なし不可)に。「検索して位置を設定」→
  「Google Maps のリンクで位置を設定」。名前・種別を結果で置き換える挙動は維持
- `Views/SharedPlaceImportView.swift`: `showsSearch` と `CheckpointSearchView` の sheet、
  「検索で位置を決める / 検索で探し直す」ボタンを削除。`resolveMessage` の文言を
  「座標未設定のまま追加できます。位置はあとから編集でリンクを貼って設定できます」に
- `xcodegen generate` を再実行(ファイルの追加・削除・リネームがあるため。古いままだと
  テスト 0 件で成功扱いになる)→ `xcodebuild build` / `test`

### Phase 3: ドキュメント・運用・デプロイ

- `docs/specs/deploy-g3plus.md`: 「AI 提案・検索補助」→「AI 提案」
- `../g3plus-ops/docs/workflows/trip-note.md` / `../g3plus-ops/CLAUDE.md` の trip-note 項:
  「経路の近くの観光地検索」の項を削除し**外向き通信先から `overpass-api.de` を外す**、
  「AI 提案・検索補助」の `search-assist` 記述を削除、Google Maps の項の「検索欄へのリンク貼り付け」は
  「リンク入力欄」に(`OVERPASS_ENDPOINT` は `.env` に入れていないので env・compose の変更なし。
  `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` は行程提案で引き続き使う)
- `TODO.md`: 「チェックポイントの追加機能を拡充する」の次の候補(カフェ / 食事 / 宿のカテゴリ検索・
  Wikipedia 要約・候補の地図表示)は Overpass 前提なので本タスクで前提が無くなる → 項目ごと削除
  (Google Maps 共有の実機確認 TODO はそのまま)
- `../g3plus-ops/CLAUDE.md` の手順でデプロイ(サーバ上で `git pull` → rebuild)。
  **iOS を先に実機へ入れてからサーバを更新する**(旧 iOS が `/api/places/nearby` /
  `/api/ai/search-assist` を呼ぶと 404 になるため。単一ユーザーなので順番を守れば問題なし)
- 親タスクを `DONE.md` へ、本プランを `docs/plans/archive/` へ

## 影響範囲

- web: 削除 6 ファイル(`api/places/nearby`・`api/ai/search-assist`・`lib/overpass`・
  `lib/category-search`・`lib/day-route`・`search-assist.tsx`)+ 変更
  (`actions.ts` / `lib/ai.ts` / `lib/nominatim.ts` / `lib/format.ts` / `place-search.tsx`(リネーム)/
  `plan-section.tsx` / `checkpoint-form.tsx` / `settings/page.tsx`)+ テスト 6 ファイル →
  **サーバデプロイあり**。DB・同期・env・compose の変更なし。npm 依存の削除なし
  (`@anthropic-ai/sdk` / `openai` は行程提案で使用中)
- iOS: 削除 2 ファイル + 変更 7 ファイル(`AIRecords` / `AIClient` / `DayRoute` /
  `CheckpointSearchView`(リネーム)/ `TripDayDetailView` / `CheckpointEditView` /
  `SharedPlaceImportView`)+ テスト 4 ファイル。`project.yml` は変更なし(ソースはディレクトリ
  glob。Share Extension・App Group・URL スキームはそのまま)
- API 互換: `/api/places/nearby` と `/api/ai/search-assist` が消える(旧 iOS は 404)。
  `/api/places/resolve-link` / `/api/route` / `/api/sync` / `/api/ai/plan|trip-outline|jobs` は不変
- データ: チェックポイントのスキーマ・同期は不変。座標 null の CP は従来から許容されている

## リスク・留意点

- **Nominatim は消さない**: `resolve-link` の補完(iOS 共有リンクの `?q=<名前, 住所>` 形)が依存する。
  消すと実機の共有で座標が取れなくなる(2026-08-23 に判明した件)。`lib/nominatim.ts` は
  ジオコーダとして縮小するだけ
- `DayRoute.anchor` は経路描画に使われている。`DayRoute.swift` を丸ごと消さない
- 座標なしの結果を「追加」できるようにするのは日詳細だけ(CP 編集・取り込みシートの「位置を設定」
  では座標が無い結果は意味が無い)。`PlaceSelection` / `Place` の座標を optional にするので、
  呼び出し側の nil 処理を漏らさない
- 「名前で検索」フォールバックが無くなるため、座標が取れない共有リンクは **座標未設定で追加 →
  あとでリンクを貼り直す** が唯一の救済になる。補完(Nominatim)の精度がそのまま体験に効くので、
  `precision: area` の注記文言は残す
- `lib/ai.ts` の search-assist 削除で `parseRouteInput` の最後の利用者が消える。
  plan / trip-outline のプロンプト・スキーマ・ジョブ処理を巻き込まないよう差分を限定する
- g3plus-ops 側のドキュメントは別リポジトリ。`overpass-api.de` を外向き通信先から外す記述を忘れない

## テスト方針

- web(vitest): 削除したモジュールのテストを消したうえで、`google-maps-share.test.ts`(21 件、
  Nominatim 補完経路を含む)が全件通ること、`nominatim.test.ts` が viewbox なしの契約で通ること、
  `ai.test.ts` の plan / trip-outline ケースが不変であること。`npm run lint` / `npm run build`
- iOS(unmanaged): `GoogleMapsShareTests` / `ShareInboxTests` / `SharedPlaceImportTests` /
  `ResolveLinkRecordsTests` が不変で通ること、`DayRouteTests` の anchor ケースが残ること。
  `xcodebuild build`(Share Extension 込み)/ `test`
- 手動(シミュレータ / Chrome):
  - 日詳細「Google Maps のリンクから追加」にブラウザ版の場所 URL を貼る → 1 件 → 追加 → 日詳細に並ぶ
  - 座標の無いリンク(`?q=<名前>` 形)→ 「座標が取れませんでした」→ 座標未設定で追加できる
  - Google Maps 以外の文字列 → 「Google Maps のリンクを貼ってください」で止まる
  - CP 編集「Google Maps のリンクで位置を設定」→ 名前・種別・座標が置き換わる
  - App Group に共有を仕込んで起動 → 取り込みシートに「検索で位置を決める」が無く、
    座標あり / なしの両方で追加できる
  - Web: `/trips/[id]` の追加・編集フォームで同じ流れ。AI 欄・「観光地」が出ないこと
- 実機: Google Maps アプリの共有シート「旅ログ」→ 取り込みシート → 追加(`./run-ios-device.sh`)
