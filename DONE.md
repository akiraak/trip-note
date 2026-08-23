# DONE - 完了済みタスク

## 2026-08-23

- 「手入力で追加」が意味不明なので「テキストを追加」に変更する [plan](docs/plans/archive/rename-manual-add-label.md)
  - 追加ボタンが「Google Maps のリンクから追加」と 2 つ並んだとき「手入力」が何を指すか分かりにくかった(リンクを手で貼るのも手入力に読める)ので、実際にやること = 名前などをテキストで打ち込む、に合わせて言い換えた
  - Web `plan-section.tsx`: 「+ 手入力で追加」→「+ テキストを追加」、開いているときは「テキスト入力を閉じる」(隣の「リンク入力を閉じる」と対称)。iOS `TripDayDetailView`: 「手入力で追加」→「テキストを追加」
  - 表示文言のみ。内部の `add-manual` / `showsManualAdd` と、予定時刻の「手入力 plannedTime」など別の意味の「手入力」は触っていない
  - 検証: web vitest 116 件 + lint + build、iOS 136 件 + シミュレータビルド、Chrome でローカル dev の目視

- チェックポイントの追加を Google Maps の共有とリンクの直接入力だけにする(他の検索機能を全て削除) [plan](docs/plans/archive/checkpoint-add-link-only.md)
  - 背景: 追加の入口が 4 つ(自由語検索・AI 検索補助・カテゴリ検索・Google Maps のリンク)に増えていたが、実際に使うのは Google Maps 経由だけだったので 3 つを UI・API・ライブラリ・テスト・ドキュメントごと削除した
  - Web: `/api/places/nearby`・`/api/ai/search-assist` と `lib/overpass.ts` / `lib/category-search.ts` / `lib/day-route.ts` / `search-assist.tsx` を削除、`actions.ts` の `searchPlacesAction` / `nearbyPlacesAction` / `searchAssistAction` と `lib/ai.ts` の search-assist 一式・`lib/format.ts` の `formatDistance` も削除。`place-search.tsx` → `place-link.tsx`(`PlaceLink`)にリネームしてリンク専用入力欄(「読み込む」→ 1 件の結果行 →「追加」)に。`lib/nominatim.ts` は resolve-link 用のジオコーダ(`searchPlaces(query)` → 座標)に縮小
  - iOS: `Domain/CategorySearch.swift` / `Models/NearbyPlaceRecords.swift` と `AIClient.searchAssist` / `nearbyPlaces`・search-assist DTO を削除。`DayRoute` は経路描画が使う `anchor` だけ残す。`CheckpointSearchView.swift` → `GoogleMapsLinkView.swift`(MapKit 検索・AI 欄・カテゴリ検索を全廃、`PlaceSelection` の座標を optional 化)。取り込みシートの「検索で位置を決める」を削除
  - 座標が取れないリンクは**日詳細の追加だけ座標未設定で追加できる**(`allowsMissingCoordinate`)。CP 編集・取り込みシートは注記のみで、位置はあとからリンクを貼り直して設定する
  - `docs/specs/server-api.md`(search-assist / nearby の節削除、resolve-link のフォールバック記述を「座標未設定のまま追加」に)・`deploy-g3plus.md`・g3plus-ops の運用ドキュメント(外向き通信先から `overpass-api.de` を削除)を更新
  - 検証: web vitest 116 件 + lint + build、iOS ユニットテスト 136 件 + シミュレータビルド、Chrome でローカル dev の E2E(リンク入力欄の表示 / 非 Google 文字列で「Google Maps のリンクを貼ってください」/ 場所 URL → 松本城 1 件 → 追加 / CP 編集が「Google Maps のリンクで設定」)

- Google Maps で場所を検索したあとの共有から受け取れるように(+ Web 版 Google Maps の URL をチェックポイントに追加できるように) [plan](docs/plans/archive/google-maps-share-import.md)
  - 方式: リンクの解決は サーバ `POST /api/places/resolve-link`(Bearer)+ Server Action に 1 本化(`lib/google-maps-share.ts`。短縮リンク `maps.app.goo.gl` の転送を許可ホスト限定で最大 5 ホップ追い、展開後 URL の `!3d!4d`(ピン)→ `q=lat,lng` → `@lat,lng`(表示中心)の順で座標、`/maps/place/<名前>` から名前。座標が取れなければ名前だけ返し、クライアントが名前検索にフォールバック。同じリンクは 24 時間キャッシュ)。**ページ本文の座標(og:image の staticmap center)は接続元 IP の既定の地図中心(シアトル)で場所と無関係と判明したので使わない**
  - Web: 検索欄(`PlaceSearch`)に Google Maps のリンクを貼ると 1 件の結果(「Google Maps のリンク(ピンの位置)」)として出て「追加」できる。プレースホルダと検索欄直下の補足文で貼れることを明記
  - iOS 本体: `SharedPlaceImportView`(取り込みシート: 名前・種別・小地図・旅行 / 日の選択・「検索で位置を決める」)、App Group の受信箱 `ShareInbox`(`group.com.akiraak.TripNote`)を起動 / 復帰 / `tripnote://share` で読んでシートを出す。検索欄(`CheckpointSearchView`)へのリンク貼り付けにも対応し、プレースホルダ + footer で明記。CP 生成は `PlanEditor.makeCheckpoint` に共通化
  - iOS Share Extension: 新ターゲット `TripNoteShare`(共有シートの「旅ログ」。URL / テキストを受信箱に入れて「旅ログを開く」= responder chain の `openURL:` 回避策)。`project.yml` に URL スキーム・App Group entitlements・Extension 埋め込みを追加、生成物(Info.plist / entitlements)は gitignore。`run-ios-device.sh` に `-allowProvisioningUpdates`
  - `docs/specs/server-api.md` と g3plus-ops の運用ドキュメント(外向き通信先に Google のホスト追加)を更新
  - 検証: web vitest 136 件(google-maps-share 21 件新規)+ lint + build、ローカル dev サーバの E2E(実物の場所ページ URL → 松本城 36.238653,137.9688674 / 名前だけの `?q=` → 名前のみ / 経路リンク・非 Google・未認証のエラー)、Chrome で Web の検索欄にリンク貼り付け → 1 件表示、iOS ユニットテスト 146 件(新規 16 件)+ Share Extension 込みのシミュレータビルド、シミュレータの App Group に共有を仕込んで起動 → 取り込みシートが開くことを確認
  - 実機検証(同日): 共有シートの「旅ログ」→ 本体の取り込みシートまで動作。ただし iOS アプリの共有リンクの展開先は `…/maps?q=<名前, 住所>&ftid=…` で座標が無く「座標が取れませんでした」になったため、`q` の名前 + 住所と共有テキストの名前を Nominatim で引く補完を追加(`precision: geocoded` / `area`、UI に注記)。実物 3 件で確認(Hotel Ruby 正確 / 松本城 正確 / 品川の店は町丁目近似)

- プランの日毎の検索に「観光地」と入れると、その日の経路の近くの観光地の情報が出てくるようにする [plan](docs/plans/archive/checkpoint-nearby-sightseeing.md)
  - 方式: OSM Overpass API をサーバでプロキシ(`lib/overpass.ts`)し iOS / Web 共通の `POST /api/places/nearby`(Bearer)+ Server Action に。経路(座標あり地点の折れ線)から半径 15km を `around:` で検索、設定行の `[bbox:]` で全体を絞る(bbox 無しだと relation の around で 16 秒タイムアウト → bbox ありで 2〜3 秒)。有名どころ(wikipedia / wikidata タグ)→ 種類の重み(城・主要スポット > 博物館・寺社 > 記念碑)→ 経路から近い順に最大 30 件。寺社・滝・温泉は wikipedia 付きのみ、山頂(`natural=peak`)は北アルプスで埋まるため対象外
  - 検索欄の「観光地 / 観光 / 観光スポット / 名所」(完全一致)でカテゴリ検索に切り替え(判定表は `lib/category-search.ts` / `Domain/CategorySearch.swift`)。結果は種類ラベル・最寄り経路地点からの距離・Wikipedia / 公式サイトのリンク付きで、追加操作は従来の一覧選択のまま。経路に座標が無い日は Web はメッセージ、iOS は MapKit 検索にフォールバック
  - 経路入力のパースを `lib/day-route.ts` の `parseRouteInput` に共通化(search-assist と共用)。`docs/specs/server-api.md` と g3plus-ops の運用ドキュメント(外向き通信先に `overpass-api.de` 追加)を更新
  - 検証: web vitest 115 件(overpass 9 件・category-search 2 件新規)+ lint + build、ローカル dev サーバ + 実 Overpass の E2E(松本 → 上高地で上高地・河童橋・松本城・林城跡…の 30 件が 2.3 秒、401 / 400 確認)、iOS ユニットテスト 130 件(CategorySearch 2 件 + DTO 2 件新規)+ シミュレータビルド

## 2026-08-22

- チェックポイント検索にその日の経路を渡す(地図検索の範囲を経路に寄せる + AI 補助に経路を文脈として渡す) [plan](docs/plans/archive/checkpoint-search-day-route.md)
  - 「その日の経路」= 前泊地(前日までの最後の座標あり CP)+ その日の訪問順 CP(座標なしも名前だけ)を iOS `Domain/DayRoute.swift` / Web `lib/day-route.ts` で共通に組み立て。`TripDetailView.routeAnchor` も同じ関数に委譲
  - Phase 1: 地図検索の範囲を経路の外接矩形 × 1.5(最低 20km 四方)に。iOS は MKLocalSearch の region(従来の旅行全体平均はフォールバック)、Web は Nominatim の `viewbox`(`bounded` なし = 優先度のみ。キャッシュキーにも含める)
  - Phase 2: `POST /api/ai/search-assist` に任意の `route`(最大 30 件)を追加し、経路があれば `area` 省略可。プロンプトで経路沿い優先・経路上の地点は除外を指示。iOS/Web の AI 欄は経路があれば地域未入力でも送れる(旧クライアント互換。`docs/specs/server-api.md` 更新)
  - 検証: iOS ユニットテスト 126 件(DayRoute 8 件 + リクエスト 1 件新規)+ シミュレータビルド、web vitest 104 件(day-route 6 件・nominatim 2 件・ai 4 件新規)+ lint + build

- チェックポイントなど座標があるところから Google Maps に転送できるようにする [plan](docs/plans/archive/checkpoint-google-maps-link.md)
  - 公式のクロスプラットフォーム URL(`https://www.google.com/maps/search/?api=1&query=<lat>,<lng>`)を使用。クエリは座標のみ(名前検索は同名の別地点に飛び得る)。iOS はユニバーサルリンクなので `comgooglemaps://` スキーム + `LSApplicationQueriesSchemes` は不要
  - iOS: `Domain/GoogleMapsLink.swift`(URL 生成の純関数)を新設し、日詳細の CP 行の長押しメニュー(行タップの「編集」は現状維持)と CP 編集画面「位置」セクションに「Google Maps で開く」を追加(座標ありのみ)
  - Web: `lib/google-maps.ts` を新設し、プラン CP 行の操作ボタン群に「地図↗」リンク、地図マーカーのポップアップに「Google Maps で開く」リンクを追加(名前は XSS 回避のため setHTML でなく DOM 組み立て)
  - 検証: iOS ユニットテスト 117 件(GoogleMapsLink 3 件新規)+ シミュレータビルド、web vitest 92 件(3 件新規)+ lint + build

- プランの各日をタップしたら日の詳細画面を表示(AI 候補のワンタップ追加・目的地の宿泊化・出発時刻と到着予想) [plan](docs/plans/archive/day-detail-editing.md)
  - Phase 1: search-assist の候補(places)に概算座標を追加し、iOS の AI 候補行に「追加」ボタンを付けてワンタップでチェックポイント化(座標なし候補は従来どおり検索クエリ反映のみ)
  - Phase 2: チェックポイント編集の「検索して位置を設定」で名前・種別も常に検索結果で置き換え(目的地 CP をホテル検索 → 宿泊にまとめて差し替えられる。保存までフォーム内なのでキャンセルで戻せる)
  - Phase 3: `trip_days.departure_time`("HH:MM"、nullable)を新設して双方向同期(push/pull・LWW・旧クライアントは省略可)。到着予想は保存せず `Domain/ArrivalEstimator.swift` が出発時刻とレグ所要時間(`durationS`)から表示時に導出し、`plannedTime` 付き CP で再アンカー。日詳細に出発時刻の表示・編集(Toggle + DatePicker)と各 CP の「到着 HH:mm頃」を追加
  - 検証: web vitest 89 件(座標パース 2 件 + departure_time 往復 1 件 + updateTripDay 2 件新規)+ lint + build、iOS ユニットテスト 114 件(ArrivalEstimator 7 件 + DTO/LWW 3 件新規)+ シミュレータビルド

- 旅行画面のプランの各日に車での走行距離を表示する [plan](docs/plans/archive/plan-day-distance.md)
  - iOS のみの変更。`/api/route` が返す `distanceM` / `durationS` を `ResolvedRouteLeg` としてキャッシュ・ビューまで通し(従来は座標列のみで距離を捨てていた)、`TripDayRow` ヘッダに「車アイコン + 約N km」を表示。未解決レグは直線距離(Haversine)でフォールバックし常に「約」表記
  - レグ解決 state をミニ地図から `TripDayRow` に持ち上げ、1 つの `.task` で地図と距離を共用(リクエスト数は不変)。`durationS` は日詳細の到着予想時刻タスク(day-detail-editing Phase 3)向けの布石
  - 検証: iOS ユニットテスト 106 件(距離合算 5 件 + 変換 1 件新規)+ シミュレータビルド

- 現在日毎のプランは出発地点と目的地が直線で結ばれているけど、車で走る道の詳細がわかるようにする [plan](docs/plans/archive/plan-road-routes.md)
  - ルートを「隣接チェックポイント間のレグ」の集合として扱い、サーバの `POST /api/route`(OSRM デモサーバのプロキシ + `route_legs` テーブルにレグ単位で無期限キャッシュ、`OSRM_ENDPOINT` で差し替え可)で道路形状を解決
  - iOS はミニ地図・トップ地図(破線)・日詳細(新規にルート表示追加)をレグ単位の道路ポリラインに差し替え。メモリキャッシュ(RouteLegCache)+ `.task(id: レグキー列)` で途中挿入・並び替えに追従、未取得・失敗レグは従来の直線フォールバック
  - 検証: web vitest 85 件(routing 10 件新規)+ lint + build、iOS ユニットテスト 100 件(レグ組み立て 7 件 + DTO 3 件新規)+ シミュレータビルド、dev サーバ + 実 OSRM で /api/route の E2E(松本→上高地→高山、キャッシュヒット・401/400 確認)

- アプリ名を「旅ログ」に変更 [plan](docs/plans/archive/rename-app-tabilog.md)
  - 表示名のみ変更(iOS: CFBundleDisplayName + navigationTitle / Web: metadata.title + ヘッダ)。ターゲット名・bundle id 等の内部識別子は不変
  - 検証: xcodegen 再生成 + iOS シミュレータビルド、web lint + build

- 旅行を生成中にアプリを切り替えたら "The network connection was lost" と表示された。生成は全部サーバでやって非同期化する [plan](docs/plans/archive/ai-async-jobs.md)
  - 原因: iOS が最大 300 秒の同期 HTTP を張りっぱなしにしており、バックグラウンド移行でソケットが切られていた(生成自体は元からサーバ側)
  - `ai_jobs` テーブルとジョブ API(POST /api/ai/jobs → 202、GET /api/ai/jobs/[id])を追加。生成は応答送信後に `after()` で実行し、iOS は 3 秒間隔のポーリング(一時的な通信エラーは無視して続行、全体 10 分で打ち切り)
  - id はクライアント発行 UUID で再送冪等。10 分更新の無い pending/running は取得時に failed へ回収。同期版 /api/ai/plan・/api/ai/trip-outline は旧クライアント互換で残置(search-assist は同期のまま)
  - 検証: web vitest 75 件(ai-jobs 12 件新規)+ lint + build、iOS ユニットテスト 92 件(ジョブ DTO 2 件新規)、curl でジョブ登録 → 実行 → ポーリングのスモークテスト

- AI 候補の採用時に最終日へ目的地チェックポイントを作る(最終日の地図が出ない件) [plan](docs/plans/archive/outline-destination-checkpoint.md)
  - trip-outline の応答に目的地の概算座標(destinationLatitude/Longitude)を追加
  - 採用時に最終日へ type=destination のチェックポイント(名前 = 目的地、概算座標付き)を作成。同日に宿泊がある場合は「到着 → 宿泊」の順
  - 候補プレビュー地図にも目的地ピンを追加。検証: web vitest 63 件 + lint + build、iOS ユニットテスト 88 件

- プラン地図に概算座標を反映(採用時に保存 + ルート描画) [plan](docs/plans/archive/plan-map-approx-coords.md)
  - 方針変更: AI の概算座標をチェックポイントに保存し、検索で具体化したら上書き(従来は保存しない方針で 2 日目以降の地図・ルートが描けなかった)
  - /api/ai/plan のチェックポイントにも概算座標を追加し、Web/iOS 両方の採用で保存。候補(nights)の座標も採用時に保存
  - 日別ミニ地図は前泊地を起点にルート描画、トップ地図に今後のプランの破線ルートを追加
  - 検証: web vitest 62 件 + lint + build、iOS ユニットテスト 86 件。既存採用済みの CP は座標なしのまま(再採用 or 検索で付く)

- 旅行画面のプラン地図(日別ミニ地図 + トップは今後の予定) [plan](docs/plans/archive/plan-maps-in-trip-view.md)
  - プラン一覧の各日に、その日のチェックポイントのミニ地図(訪問順ピン + ポリライン、操作不可)を表示
  - トップ地図のプランピンを今日以降の日(当日含む)に絞る。全て過去日なら全件フォールバック。軌跡・メディアは従来通り
  - PlanEditor.upcomingDays を新設しユニットテスト(iOS 85 件パス)。iOS のみの変更でデプロイ不要

- 旅行作成時に現在地を出発地へ自動反映 [plan](docs/plans/archive/auto-departure-current-location.md)
  - フォームを開いたら現在地を自動取得して出発地に入れる(手入力があれば上書きしない)
  - AI 候補リクエストの出発地は作成時の state を直接渡す(SwiftData 逆参照のタイミング非依存に)
  - プロンプト防御: 出発地未指定なら出発都市を仮定せず目的地周辺で完結させる

- プラン表示の UI 再構成 [plan](docs/plans/archive/plan-first-ui.md)
  - 「記録を開始」を旅行の中へ(LocationRecorder.startRecording(trip:) 新設。自動選択・自動作成の beginOrResumeTrip は廃止)。撮影ボタンも旅行内へ
  - 旅行作成後はその旅行の中へ遷移(NavigationStack path + onCreated)
  - AI 候補ごとにミニ地図(nights に概算座標を追加。プレビュー専用で CP には保存しない)
  - 旅行画面は地図 → プラン(日別 + CP 名の概要)→ 記録 → 基本情報 → … の順に変更
  - 日詳細にもその日のチェックポイント地図を表示。UI テストも新フローに追従
  - 検証: web vitest 60 件 + lint + build、iOS ユニットテスト 82 件 + UI テストターゲットのビルド

- 移動手段を車に固定 [plan](docs/plans/archive/transport-fixed-to-car.md)
  - 選択 UI(ピッカー)と表示行を削除し、作成時は常に car、編集保存時も car へ正規化。AI へは trip.transport ?? car を送る
  - データモデル・同期・API は変更なし(trips.transport は残す)

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
