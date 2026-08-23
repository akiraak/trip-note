# Google Maps で場所を検索したあとの共有から受け取れるようにする

## 目的・背景

旅行先の場所は Google Maps で探すことが多い(営業時間・写真・レビューが見られる)。
いまは見つけた場所を旅ログに入れるには、名前を覚えて旅ログ側の検索欄に打ち直す必要がある。
**Google Maps の「共有」シートに「旅ログ」が出て、選ぶとその場所がチェックポイントとして
追加できる**ようにする。Web 版でも Google Maps の共有リンクを検索欄に貼れば同じ場所が
出るようにする。

現状の材料:

- 旅ログ → Google Maps の向き(座標から Maps URL を組む)は済んでいる
  (iOS `Domain/GoogleMapsLink.swift` / Web `lib/google-maps.ts`、
  [checkpoint-google-maps-link](archive/checkpoint-google-maps-link.md))。逆向きは無い
- iOS に Share Extension・URL スキーム・App Group は無い(`project.yml` はアプリ +
  テスト 2 ターゲットのみ)。SwiftData のストアは既定の場所(`TripNoteApp.init`)
- チェックポイントの追加は iOS `TripDayDetailView.addCheckpoint(from: PlaceSelection)`、
  Web `PlaceSearch` の `onSelect(Place)` に集約されている。どちらも
  「名前 + 座標 + 種別の推測」を渡せば既存の経路で追加・同期される
- 外部サービスをサーバでプロキシする型(User-Agent・キャッシュ・Bearer の API route +
  Server Action)は Nominatim / Overpass で確立済み(`lib/nominatim.ts` / `lib/overpass.ts`)

Google Maps の共有で渡ってくるもの(iOS アプリの共有シート):

- テキスト `"松本城\nhttps://maps.app.goo.gl/XXXX"`(`public.plain-text`)と、同じ短縮 URL
  (`public.url`)。**1 行目が場所名、URL が短縮リンク**
- 短縮リンクは 302 で `https://www.google.com/maps/place/<名前>/@<lat>,<lng>,17z/data=...!3d<lat>!4d<lng>...`
  の形に展開される(`!3d!4d` がピンの座標、`@` の座標は表示中心)。ドロップピン・
  検索結果など共有元によって `?q=<lat>,<lng>` や `/maps/search/` の形もある
- 2026-08-23 に手元で確認: 名前だけの `/maps/place/<名前>` は 200 を返すが URL にも本文にも
  座標は出ない。**座標は「展開後の URL」から取る前提で、共有元ごとの実際の形は Phase 0 で
  実機から採取して固定する**

## 方式の選択

### 受け取り口(iOS)

| 方式 | 長所 | 短所 |
| --- | --- | --- |
| **Share Extension(共有シートに「旅ログ」)** | Google Maps の共有から直接。ユーザーの望む操作そのもの | 新ターゲット + App Group + 署名の capability が増える。Extension からホストアプリを開く公式 API が無い |
| URL スキーム / ユニバーサルリンクのみ | 構成が軽い | Google Maps の共有シートには出ない(コピー → 旅ログで貼り付け、の 2 段になる) |
| 検索欄への URL 貼り付けのみ | 最小 | 同上。Web 版には必要なので**どのみち作る**が、iOS の主経路にはしない |

**Share Extension を本命にし、検索欄への URL 貼り付け(iOS / Web)も同じ解決処理で対応する。**

### Extension の役割

| 方式 | 長所 | 短所 |
| --- | --- | --- |
| **Extension は受け取るだけ(App Group に置いて本体へ渡す)** | Extension が小さい(SwiftData・サーバ設定・ネットワーク不要)。取り込み UI は本体に 1 つ | 本体を開く一手間(ボタン) |
| Extension 内で旅行 / 日を選んで追加まで行う | 本体を開かずに完結 | SwiftData ストアを App Group に移す必要がある(既存データの移行 = 事故の元)。ServerConfig・同期も Extension に複製 |

**受け取るだけにする。** 本体側で「取り込みシート」を出して旅行 / 日を選ぶ。

### リンクの解決場所

| 方式 | 長所 | 短所 |
| --- | --- | --- |
| **サーバ(`POST /api/places/resolve-link`)** | パーサが 1 つ。Google が URL 形式を変えても**サーバ側だけ直せばアプリの再ビルド不要**(実機配布は USB なので効く)。Web はブラウザからリダイレクト先を読めないのでどのみちサーバが要る | サーバ未設定だと座標が取れない(→ 名前で検索にフォールバック) |
| iOS ローカル(URLSession で展開 + Swift パーサ) | オフラインでも動く | パーサが Swift / TS の 2 つになる |

**サーバで解決する。** iOS はサーバ未設定でも共有テキストの 1 行目(場所名)で既存の
MapKit 検索にフォールバックできるようにする。

## 対応方針

### 共通仕様(リンクの解決)

- 入力は「共有テキスト or URL」。テキストから Google Maps の URL を 1 つ抜き出す
  (ホスト許可リストは 1 箇所で定義: `maps.app.goo.gl` / `goo.gl` / `share.google` /
  `maps.google.com` / `www.google.com` / `google.com` / `www.google.co.jp` /
  `maps.google.co.jp`。Phase 0 で見つかった形を足す)
- 短縮リンクは `redirect: "manual"` で最大 5 ホップまで追う。**各ホップの行き先も許可リストで
  検証する**(SSRF 対策。`consent.google.com` など許可外に飛んだら「解決できません」)。
  タイムアウト 10 秒、User-Agent は Nominatim と同じ `trip-note/0.1`
- 展開後 URL のパース(純関数、優先順):
  1. `data=` の `!3d<lat>!4d<lng>` → ピンの座標(`precision: "pin"`)
  2. クエリ `q` / `query` / `ll` / `center` / `destination` が `<lat>,<lng>` → 座標(`pin`)
  3. `/maps/place/<名前>/@<lat>,<lng>,<zoom>` → 表示中心の座標(`precision: "center"`。
     ピン無しの共有ではこれが場所の位置)
  4. 名前: `/maps/place/<名前>`(デコード、`+` → 空白)、無ければ `q` / `query` の文字列、
     無ければ `/maps/search/<名前>`
  5. `/maps/dir/`(経路)は非対応 → 「経路のリンクは取り込めません(場所のリンクを共有
     してください)」
- 結果 `{ name, latitude, longitude, precision, resolvedUrl }`。座標が取れず名前だけの場合も
  200 で返し(`latitude` / `longitude` / `precision` は null)、クライアントが**名前で既存の
  検索**にフォールバックする。名前も座標も取れなければエラー
- 同じリンクは 24 時間キャッシュ(`lib/nominatim.ts` と同じ LRU)。直列スロットルは不要
- チェックポイントの種別は一律 `sightseeing`(編集で直せる)。Google Maps のカテゴリは
  URL から取れない

### Phase 0: 共有リンクの形を実機から採取する

- 実機の Google Maps アプリから共有して、渡ってくる `NSItemProvider` の型(`public.url` /
  `public.plain-text`)と内容、短縮リンクの展開先(`curl -sI -L`)を記録する。対象:
  (a) 検索した施設のピン、(b) 地図長押しのドロップピン、(c) 検索結果一覧からの共有、
  (d) Safari の Google Maps の「共有」、(e) Mac のブラウザ版「リンクをコピー」
- 採取した URL を `web/test/google-maps-share.test.ts` のフィクスチャにして、パーサの
  テストは**実物の形**で書く(この Phase の成果物はプランへの追記とフィクスチャ)

### Phase 1: サーバ `POST /api/places/resolve-link` + Server Action

- `web/src/lib/google-maps-share.ts`: `extractGoogleMapsUrl(text)`、
  `parseGoogleMapsUrl(url)`(純関数)、`resolveGoogleMapsLink(input, fetchImpl?)`
  (リダイレクト追跡 + 許可リスト + キャッシュ)。既存 `google-maps.ts`(生成側)とは
  別ファイルにして、クライアントからも純関数を import できるようにする
- API route `app/api/places/resolve-link/route.ts`(Bearer)。リクエスト `{ "link": "<URL or 共有テキスト>" }`、
  レスポンス `{ "place": { name, latitude, longitude, precision, resolvedUrl } }`。
  Google Maps の URL を含まない / 経路リンク → 400、展開失敗 → 500(nearby と同じ扱い)
- Server Action `resolveGoogleMapsLinkAction(link)`(`actions.ts`、Access 配下・Bearer なし)
- `docs/specs/server-api.md` に追記

### Phase 2: Web の検索欄にリンク貼り付けで対応

- `PlaceSearch.searchWith`: 入力に Google Maps の URL が含まれていれば(カテゴリ語判定より
  先に)`resolveGoogleMapsLinkAction` を呼ぶ
  - 座標あり → 既存の一覧 UI に 1 件(`displayName` は「Google Maps のリンク(ピンの位置)」
    / 「(地図の中心)」)。「追加」は既存の `onSelect` のまま
  - 名前のみ → 検索欄をその名前に置き換えて通常検索を実行し、「リンクから座標が取れなかった
    ため名前で検索しました」を表示
- **URL が貼れることを UI に明記する**(知らないと使われない機能のため):
  - 検索欄のプレースホルダを「場所名・住所、または Google Maps のリンク」にする
    (経路に座標があるときは「(「観光地」で経路の近くを探す)」を併記)
  - 検索欄の直下に常時表示の補足(`text-xs text-zinc-500`)を置く:
    「Google Maps で場所を開き「共有」→「リンクをコピー」したものを貼ると、その場所を追加できます」

### Phase 3: iOS 本体(取り込みシート・URL スキーム・検索欄貼り付け)

- `Models/ResolveLinkRecords.swift`(DTO)、`Services/AIClient.swift` の extension に
  `resolveLink(_:)`(nearby と同じ送受信に相乗り)
- `Domain/GoogleMapsShare.swift`(純関数): 共有テキストから URL を抜く、1 行目を名前の
  ヒントにする(URL 行は除く)。Extension と共用するため**両ターゲットのソースに入れる**
- `Services/ShareInbox.swift`: App Group の `UserDefaults(suiteName: "group.com.akiraak.TripNote")`
  に `PendingShare { text, url, receivedAt }` の配列を Codable で読み書きする(Extension が
  書き、本体が読んで消す)。両ターゲット共用
- `Views/SharedPlaceImportView.swift`(取り込みシート):
  - 開いたらサーバでリンクを解決(進行表示)。名前はサーバの結果 → 共有テキストの 1 行目
    の順で埋め、編集可。座標ありなら小地図で位置を表示
  - 旅行の選択(既定: 一覧の先頭 = プラン中 / 進行中の最新)と日の選択(既定: 旅行が
    進行中で今日が日程内なら今日、それ以外は最初の日)。日が無い旅行には「日を追加してから」
    の案内。既定の決め方は純関数に切り出してテストする
  - 「追加」→ `TripDayDetailView.addCheckpoint` と同じ生成(`PlanEditor` に
    `addCheckpoint(name:latitude:longitude:type:to:)` として寄せて両方から使う)→ save →
    `sync.syncNow()`。追加後はその日の詳細へ遷移できるようにする(`path.append`)
  - 座標が取れなかった(名前のみ / サーバ未設定)→ 「検索で探す」で
    `CheckpointSearchView` を名前入りで開き、選択結果を同じ日に追加
- 起動・復帰時の受け取り: `ContentView` で `.onOpenURL`(`tripnote://share`)と
  `scenePhase == .active` の両方で `ShareInbox` を読み、未処理があればシートを出す
  (ナビゲーションの深さに関係なく出るように root で `.sheet(item:)`)。複数溜まっていたら
  1 件ずつ順に
- URL スキーム `tripnote` を `project.yml` の `CFBundleURLTypes` に追加
- `CheckpointSearchView.search()`: 入力に Google Maps の URL があればサーバで解決して
  1 件の結果として出す(Web の Phase 2 と同じ挙動。コピーしたリンクを貼る経路)。
  Web と同じく **URL が貼れることを UI に明記する**: プレースホルダを
  「場所名、または Google Maps のリンク」にし、検索欄のセクションの footer に
  「Google Maps の「共有」→「リンクをコピー」したものを貼ると、その場所を追加できます。
  Google Maps の共有シートから直接「旅ログ」を選ぶこともできます」を常時表示する

### Phase 4: iOS Share Extension

- `project.yml` に `TripNoteShare` ターゲット(`type: app-extension`)を追加し、本体の
  `dependencies` に `- target: TripNoteShare` で埋め込む。Info.plist:
  `NSExtensionPointIdentifier: com.apple.share-services`、
  `NSExtensionPrincipalClass: $(PRODUCT_MODULE_NAME).ShareViewController`、
  `NSExtensionActivationRule: { NSExtensionActivationSupportsWebURLWithMaxCount: 1, NSExtensionActivationSupportsText: true }`
  (テキスト共有全般に出るが、Google Maps のリンクが無ければ Extension 側でその旨を表示)。
  `CFBundleDisplayName: 旅ログ`、バンドル ID `com.akiraak.TripNote.Share`
- App Group `group.com.akiraak.TripNote` を本体・Extension 両方の entitlements に入れる
  (XcodeGen の `entitlements.properties` で生成)
- `TripNoteShare/ShareViewController.swift`: `UIViewController` + `UIHostingController` の
  最小 UI。`extensionContext` の item から URL / テキストを取り出し → `ShareInbox` に追記 →
  「旅ログに送りました」と**「旅ログを開く」ボタン**(responder chain をたどって
  `UIApplication.open` を呼ぶ既知の回避策で `tripnote://share` を開く。Extension から
  ホストアプリを開く公式 API が無いため、効かなければ「旅ログを開くと取り込めます」の表示で
  完了)。Google Maps のリンクが無ければエラー表示のみ
- 署名: App Group は capability の登録が要るため、`run-ios-device.sh` の `xcodebuild` に
  `-allowProvisioningUpdates` を足す(Xcode に Apple ID でログイン済みが前提)。
  シミュレータは entitlements だけで動く

### スコープ外(将来)

- Apple Maps の共有(`maps.apple.com/?ll=…`。パーサにホストと形式を足せば同じ経路で扱える)
- Android(Intent の `ACTION_SEND`)
- Web を共有先にする(PWA の `share_target`。Access 配下で要検討)
- Google Maps のカテゴリ(飲食 / 宿)からの種別推測。共有リンクには入っていない
- 共有された写真・経路(`/maps/dir/`)の取り込み

## 影響範囲

- web: 新規 `lib/google-maps-share.ts` / `app/api/places/resolve-link/route.ts`、
  `app/trips/[id]/{actions.ts,place-search.tsx}` / `docs/specs/server-api.md` →
  **サーバデプロイあり**。env・compose の変更なし。**コンテナの外向き通信先に
  `maps.app.goo.gl` / `www.google.com` など Google のホストが増える** →
  `../g3plus-ops/docs/workflows/trip-note.md` と `../g3plus-ops/CLAUDE.md` の trip-note 項に
  追記する(Overpass 追加時と同じ)
- iOS: 新規ターゲット `TripNoteShare/`、`project.yml`(URL スキーム・App Group・Extension
  の埋め込み)、新規 `Domain/GoogleMapsShare.swift` / `Services/ShareInbox.swift` /
  `Models/ResolveLinkRecords.swift` / `Views/SharedPlaceImportView.swift`、
  `Services/AIClient.swift` / `Domain/PlanEditor.swift` / `ContentView.swift` /
  `Views/CheckpointSearchView.swift` / `Views/TripDayDetailView.swift`、`run-ios-device.sh`。
  `xcodegen generate` を再実行
- DB・同期: 変更なし(チェックポイントの追加は既存の needsSync で同期される)

## リスク・留意点

- Google Maps の URL 形式は非公式で変わり得る。パーサをサーバに置くのはそのため。
  Phase 0 のフィクスチャを実物に保ち、形が変わったらフィクスチャを足して直す
- Extension からホストアプリを開くのは非公式の回避策。効かない場合はボタン無しで
  「旅ログを開くと取り込めます」に倒す(App Group 経由の受け渡しは残るので機能はする)
- App Group の capability は Apple Developer 側の App ID に登録される。`-allowProvisioningUpdates`
  で自動登録されるが、初回は Xcode から実機ビルドした方が確実
- Extension は SwiftData ストアに触らない(ストアの移動・共有は行わない)
- 共有テキスト全般に Extension が出るため、Google Maps 以外から共有されたときの文言を
  用意する。Safari の URL 共有(`public.url` のみ、名前無し)も受ける
- 欧州の `consent.google.com` リダイレクトは許可外として失敗にする(日本からは発生しない)

## 実装時の知見(2026-08-23)

- Phase 0 は実機が無いため、ブラウザ版 Google Maps の場所ページの URL(`/maps/place/松本城/@36.238653,137.9688674,17z/data=…!8m2!3d36.238653!4d137.9688674…`)を採取してフィクスチャにした。共有ダイアログのリンク欄は自動操作では取れず、短縮リンクの実際の展開先は**実機での確認が残っている**(TODO.md)
- **ページ本文からの座標フォールバックは削除した**。名前だけの場所ページ・`?q=<名前>` ページの og:image(staticmap center)や本文の座標は、接続元 IP から推定した既定の地図中心(g3plus / 手元ともシアトル)で場所と無関係。座標は展開後の URL からだけ取り、無ければ名前だけ返してクライアントが名前検索にフォールバックする
- XcodeGen が生成する Extension の `Info.plist` と両ターゲットの `.entitlements` は本体の `Info.plist` と同様に gitignore(正本は `project.yml`)
- シミュレータでの取り込みシートの確認は、`xcrun simctl get_app_container <udid> com.akiraak.TripNote groups` で App Group のコンテナを探し、`Library/Preferences/group.com.akiraak.TripNote.plist` の `pendingShares`(JSON の Data)に共有を書いて再起動すればよい(Extension を操作しなくても本体側の流れを試せる)
- 同名の旅行が複数あるとき、取り込みシートの旅行 Picker はタイトル表示のため見分けにくい(日付で区別できるよう将来改善の余地)

## テスト方針

- web(vitest、fetch モック): テキストからの URL 抽出(本文中・複数行・許可外ホストの無視)、
  展開後 URL のパース(Phase 0 の実物フィクスチャ: `!3d!4d` / `q=lat,lng` / `@` 中心 /
  名前のみ / `/maps/dir/` 拒否)、リダイレクト追跡(ホップ上限・許可外ホストで中断・
  `Location` 相対 URL)、キャッシュ、API の 401 / 400 / 500
- iOS(unmanaged): `GoogleMapsShare`(URL 抽出・名前ヒント)、`ShareInbox` の読み書き
  (テスト用 suite 名でラウンドトリップ)、取り込み先(旅行 / 日)の既定の決め方、
  DTO のデコード
- 手動:
  - シミュレータ: Safari で短縮リンクを開き「共有」→「旅ログ」→「旅ログを開く」→
    取り込みシートに名前・座標が出て、旅行 / 日を選んで追加 → 日詳細に並ぶ → Web に同期
  - 実機: Google Maps アプリの施設ピン / ドロップピン / 検索結果から共有 → 同上。
    サーバ未設定(ServerConfig 差し替え)時は名前で検索にフォールバックする
  - iOS / Web の検索欄にリンクを貼る → 1 件出て追加できる。名前しか取れないリンクは
    名前検索に切り替わる
- `xcodebuild build` / `test`(Extension ターゲット含む)、`./run-ios-device.sh` での実機
  インストール、`npm run lint` / `npm run build` / `npm test` の通過
