# DONE - 完了済みタスク

## 2026-08-24

- 写真・動画の一覧を新しい順にする(iOS / Web) [plan](docs/plans/archive/media-newest-first.md)
  - 撮影・追加日時(`taken_at` / `takenAt`。EXIF・動画メタデータが無ければ取り込み時刻)の降順にして、
    撮ったばかりのものが先頭に来るようにした
  - iOS は `TripEntity.sortedMedia` を降順に（旅行画面のグリッドと地図ピンが同じ並びになる）、
    Web は旅行詳細のメディア取得 SQL を `order by m.taken_at desc, m.id desc` に変更
  - 同時刻(バースト撮影など)で並びが揺れないよう、両方とも `id` を第 2 キーにした
    （Swift の `sorted` は安定ソートではなく、SQL も同値時の順序は未定義）
  - 同期・紐付け側（`SyncEngine` の `SortDescriptor(\.takenAt)` / `lib/media-link.ts`）は
    近傍探索で昇順が前提なので触っていない
  - iOS 195 テスト緑 / Web 213 テスト緑 + lint・build 通過。Web の一覧 SQL は page.tsx から
    抜き出して一時 DB で並び（新しい順・同時刻は id 降順）を確認した

- Web のチェックポイントに到着予想時刻を出す [plan](docs/plans/archive/web-arrival-estimates.md)
  - iOS の日詳細には「HH:MM 頃」が出るのに Web は予定時刻(`planned_time`)しか出しておらず、
    同じデータを見ているのに Web からは到着予想が見えなかった（parity メモでレグ解決待ちにしていた項目）
  - iOS の `Domain/ArrivalEstimator.swift` を `web/src/lib/arrival.ts` に移植（出発時刻を anchor に
    解決済みレグの `durationS` を累積 / `planned_time` のある CP で再アンカーしその CP は予想なし /
    未解決レグ以降は打ち切り / 座標なし CP は飛ばして連鎖）。レグキーの丸め規約は
    `lib/route-legs.ts` を共有（`isDegenerate` を export）
  - 日カード（`plan-section.tsx`）で `useRouteLegs` の解決済みレグから予想を出し、
    チェックポイント行に「HH:MM 頃」を表示。予定時刻がある CP はこれまでどおり予定時刻を出す
  - `test/arrival.test.ts` を新設し iOS の `ArrivalEstimatorTests` とケース対応させた
    （Web 213 テスト緑 + lint / build 通過）。ブラウザでも 2 日目（出発 08:30）に
    09:10 頃 / 09:25 頃 / 10:15 頃 が出ることを確認（hydration 警告なし）

- Web のプラン日付テストを新仕様に追従させる [plan](docs/plans/archive/web-plan-date-shift-tests.md)
  - 「プランの日付は動かさない(1 日目の日付は作成時に決まる)」が赤いまま残っていた。80f6032 が
    `lib/plan.ts` を変えたときに Web のテストだけ更新されず（iOS は同コミットで更新済み）、
    さらに 19a6134 で規則が「1 日目を出発日にそろえる」に変わったのにも追従していなかった
  - `updateTrip` のテストを新仕様に差し替え（各日と `planned_time` が同じ日数動く / tombstone の日と
    `planned_time` の無いチェックポイントは触らない / 1 日目がずれていてもそろえる /
    時刻だけの変更・出発日の削除では動かさない）
  - `web/test/plan-dates.test.ts` を新設し、`dayDifference` / `departureShiftDays` /
    `planShiftNotice` を iOS の `PlanEditorTests` とケース対応させた（Web 側は 0 件だった）
  - 実装は変更なし（テストのみ）。Web 204 テスト緑 + lint 通過。19a6134 前の規則に戻すと
    新テスト 2 件が落ちることも確認した

- 記録バー（画面下の常駐バー）の実機確認（実装は 2026-08-23 の [recording-status-bar.md](docs/plans/archive/recording-status-bar.md)）
  - シミュレータでは確認できなかった 3 点を実機で確認し、いずれも想定どおりだった
    - 記録開始 → 別画面でバーの📷から撮影 → 撮ったメディアが対象の旅行に入る（シミュレータにカメラが無く、`PhotosPicker` に差し替わるため未確認だった）
    - 画面 OFF → 復帰でバーの地点数・距離が伸びている（バックグラウンドでも記録が続く）
    - 位置情報を拒否した状態でバーに赤い文言が出て、タップで設定アプリへ飛べる
  - コード変更なし（確認のみ）

- 写真・動画と GPS の紐付けの取りこぼしを減らす [plan](docs/plans/archive/media-gps-linkage-fix.md)（調査: [media-gps-linkage-check.md](docs/plans/archive/media-gps-linkage-check.md)）
  - **Phase 1: EXIF 日時のタイムゾーン + 時間差の上限**（iOS）
    - `MediaCaptureTime`(新規) が EXIF の `DateTimeOriginal`(タイムゾーンを持たない壁時計時刻)を ① `OffsetTimeOriginal` ② GPS の `GPSDateStamp`/`GPSTimeStamp`(UTC)との差から推定(15 分単位に丸め、測位が 2 分以上ずれていれば不採用)③ 端末 TZ、の順に補って絶対時刻にする。**旅行先で撮った写真を帰宅後に取り込んでも時差分ずれない**(米国旅行 → 日本で 16 時間ずれていた)
    - `MediaAttachment.nearestIndex` に許容時間差を追加。**記録範囲の内側は時間差で弾かず、外側にはみ出した分だけ 30 分まで**(静止中は `distanceFilter = 10m` + `LocationPointFilter` で点が増えないので、正しい紐付けでも数十分空く)。上限が無いと記録と無関係な写真が端の点に引き寄せられて**嘘の位置で地図に出ていた**
  - **Phase 2: 後追いの再紐付け**（iOS + Web）
    - GPS 記録を始める前に取り込んだ写真は `locationPoint = nil` で固定されていた。iOS は同期のたびに `SyncEngine.relinkMedia` が未紐付けメディアを再評価し、サーバは `POST /api/sync` で点を受けた後に `lib/media-link.ts` が同じルールで埋め直す
    - **両側が独立に同じ結果へ収束させる方式**にした理由: media は不変・一方向アップロード(`insert or ignore`)なので、iOS がローカルで紐付け直しても送り直しでは反映されない。サーバ側だけの修復では iOS のローカル表示が直らない
  - **Phase 3: メディア自身の EXIF GPS を使う**（iOS + Web、スキーマ変更あり）
    - `media` に `latitude` / `longitude` を追加（マイグレーション。**本番反映時は起動時に自動適用**）。`POST /api/media` に任意クエリ `latitude` / `longitude`（範囲外・片方だけは 400）
    - iOS は写真の EXIF GPS・動画 common メタデータの location(ISO 6709)を `MediaCoordinate`(新規) で読む。ライブラリ取り込みは JPEG 再エンコードで EXIF が落ちるため元データから、動画は mp4 変換前の元ファイルから読む
    - **地図はメディア自身の位置を優先し、無ければ記録点**（iOS `MediaEntity.displayCoordinate` / Web `coalesce(m.latitude, p.latitude)`）。GPS 記録の無い旅行や他端末で撮った写真も地図に出る
    - アプリ内カメラ撮影は UIImage 経由で EXIF を持たないため対象外（記録中なら従来どおり記録点に紐付く）
  - 判定ルールは iOS(`Domain/MediaAttachment.swift`)と Web(`lib/media-link.ts`)で同じ値を持つ。片方だけ変えない
  - 検証: iOS 194 テスト / Web 191 テスト（`plan.test.ts` の 1 件は今回と無関係の既存の赤。TODO に切り出した）/ lint + build

- 撮影された写真・動画と GPS 情報が連携できるかの調査 [plan](docs/plans/archive/media-gps-linkage-check.md)
  - **結論: 連携できている**。`media.location_point_id` → `location_points.id` の紐付けは実装済みで、本番の「テスト」旅行（GPS 687 点)のメディア 4 件はすべて点に紐付いていた(時間差 3 秒〜3 分 48 秒。開いている分は静止中で点が間引かれたためで、座標はずれていない)
  - 仕組み: iOS の `MediaImporter.insert()` が保存時に `MediaAttachment.nearestIndex()` で撮影時刻に最も近い記録点を選ぶ → `SyncEngine` が points → media の順に送る → サーバは id が実在すれば保存(無ければ null) → iOS `TripDetailView` と Web `trips/[id]` が地図マーカーに使う
  - 見つかった限界は直さず記録に留めた(時間差の上限なし / 後追いの再紐付けなし / 写真の EXIF GPS 未使用 / EXIF 日時のタイムゾーン解釈 / サーバ側の修復なし)。追随タスクは `TODO.md` へ

- 旅行ページの TIMELINE(GPS 記録点の一覧)表示を iOS・Web とも消す [plan](docs/plans/archive/remove-timeline-section.md)
  - 記録点をそのまま全件並べるだけのセクションで、長時間記録した旅行では数百行になり読み物にならなかった(同じ点は地図の軌跡として描かれ、件数と総距離は統計に出ている)
  - **表示だけを消し、データは残す**: location_points の記録・同期・地図の軌跡・地点数/総距離の統計は変更なし。iOS の `timelineSection` と `PointRow`、Web の Timeline セクションを削除(points の取得は距離計算と地図に使うので残す)
  - iOS と Web を同じコミットで消して情報を揃えた(CLAUDE.md の情報パリティ)。`docs/plans/archive/web-ios-info-parity.md` にも追記
  - 検証: iOS 175 テスト / Web lint + build / ブラウザで TIMELINE が消え、地図の軌跡と地点数・総距離(2 地点・2.05 km)は残ることを確認

- 旅行の出発日を変えたらプランの各日付も一緒に動かす [plan](docs/plans/archive/departure-date-shifts-plan.md)
  - 出発予定日を編集してもプランの日付は据え置きで(Web の編集フォームにも「プランの日付は動きません」と明記していた)、出発が 1 日ずれるだけで日ごとのチェックポイントを手で直す必要があった
  - **ずらす量の規則**(iOS `PlanEditor.departureShiftDays` / Web `lib/plan-dates.ts` で同じ): **出発日を変えたら 1 日目がその日になるようにそろえる**(2 日目以降も同じ日数動くので日どうしの間隔は保つ)。出発日を消した / 時刻だけ変えた / 日が 1 つも無い場合は動かさない
    - 当初は「旧出発日 → 新出発日の差だけ動かす」にしていたが、**元から 1 日目が出発日とずれている旅行では、そのずれが残り続けて「出発日を 23 日にすると 1 日目が 22 日」に見える**(実際に本番の旅行が 1 日ずれていた)。ずれの是正も兼ねて 1 日目を出発日にそろえる規則へ直した。時刻だけの変更で動かさないのは据え置き(触っていない出発日でプランが動くと驚くため)
  - **チェックポイントの `planned_time` も同じ日数動かす**(日付だけの `date` と絶対時刻がずれないように。日の挿入・削除と同じ扱い)。**動かした行だけ** `updated_at` を進める(触らない行の updated_at を進めると LWW でもう一方の編集を潰すため)
  - iOS は既存の `shiftDays(after:by:)` と共通の内部処理に整理して `shiftAllDays` を追加。Web は `shiftDaysAfter` を任意日数に一般化し、`updateTrip` をトランザクションの中で日ずらしまで行うようにした
  - **編集フォームで予告する**: 「プランの日付も N 日うしろ/まえへ動きます」を保存前に出す(iOS の `TripEditView` と Web の `edit-trip.tsx`。文言も同じ)
  - 検証: iOS 173 テスト(`departureShiftDays` の 旧あり/旧なし/消去/時刻だけ/日なし、`shiftAllDays`、予告文言)/ Web lint + build / ブラウザで実操作(9/1 → 9/4 で 3 日うしろ、9/4 → 9/2 で 2 日まえ。DB で日付と planned_time が一緒に動くことを確認)
  - iOS の編集シートでの操作も UI テスト(`TripEditShiftUITests`)で確認: 旅行を作成 → 旅行を編集 → カレンダーで 3 日後を選ぶ → 予告が出る → 保存でプランの 1 日目が動く。位置シミュレーションもサーバも要らない
  - **「iOS で変わらない」という指摘は端末のアプリが変更前のビルドだったため**(サーバのデプロイでは iOS アプリは更新されない)。`./run-ios-device.sh` で実機へ入れ直した

- Web からも写真・動画を削除できるようにする [plan](docs/plans/archive/web-media-delete.md)
  - 同日の削除実装は iOS 限定だったため、Web の閲覧中に消したいものを見つけても消せなかった。**media の「削除だけ」を双方向**にした(ファイル本体は従来どおり iOS → サーバの一方向アップロードのまま)
  - サーバは `media.deleted_at`(tombstone)を追加し、削除では**ファイルを物理削除・行は tombstone として残す**。削除の実処理は `web/src/lib/media.ts` に集約して、**Web の Server Action と `DELETE /api/media`(iOS)が同じ関数**を呼ぶ
  - `GET /api/sync/pull` が media の tombstone(`id` / `trip_id` / `deleted_at`)も返すようにし、iOS は受け取ったらローカルのファイルと行を消す。**pull で作り直せないのでローカルには tombstone を残さない**。旧サーバ互換のため `media` キーが無い応答も受け付ける(`PullResponse.media` は省略可)
  - 表示・配信は tombstone を除外(旅行詳細のグリッド・地図マーカー、`GET /media/[id]` は 404)。**削除済み id への再アップロードはファイルを書かずに 200** を返し、Web で消した直後に iOS が再送してもファイルが復活しない
  - Web の UI は各メディアの下に「削除」(二段階確認。`delete-media.tsx`。DeleteTrip と同じ作法)
  - 検証: Web lint + build / iOS 166 テスト / curl で DELETE → tombstone・ファイル 0 件・`GET /media/[id]` 404・pull の tombstone(since の絞り込み含む)・再 POST でファイルが復活しないこと / ブラウザで削除ボタンを実操作 / シミュレータ E2E に `testServerDeletedMediaDisappearsAfterSync`(サーバ側で削除 → 同期 → iOS から消える)を追加
  - UI テストからサーバを叩く環境変数は **`TEST_RUNNER_` 付き**で渡す(テストはシミュレータ内で動くため、付けないと届かず skip される)

- 写真・動画の削除と、カメラアプリで撮影したものの取り込み導線 [plan](docs/plans/archive/media-delete-and-import.md)
  - **削除**(これまで iOS / Web / サーバのどこにも無かった): 旅行詳細のメディアグリッドの**長押し**、またはフルスクリーンビューアの**ゴミ箱**から。どちらも確認ダイアログ付きで、文言は「端末とサーバの両方から削除され、Web からも見えなくなります。」
  - 同期モデルは media が不変・一方向アップロード(pull しない)なのに合わせて **push だけで表現**した。`MediaEntity.deletedAt`(tombstone)を追加し、`MediaImporter.delete` が**ローカルのファイル(本体・サムネイル)は即削除**して行だけ残す。`SyncEngine.pushMedia` は `deletedAt != nil` ならアップロードの代わりに `DELETE /api/media?id=` を送り、成功したら**ローカル行も物理削除**する(tombstone を残す先が無いため)。オフライン中の削除は次回同期で再送
  - サーバの `DELETE /api/media`(Bearer): ファイル → 行の順で消す。**404 はクライアント側で成功扱い**にして冪等にした(アップロード前に消した場合や、アップロード応答を取りこぼしてサーバに孤児行が残った場合も確実に消える)
  - **取り込み導線**: 機能自体はあったが旅行詳細ツールバーのアイコンだけで気づけなかったので、MEDIA セクションに**ラベル付きの「写真・動画を追加」**(PhotosPicker)を出し、ツールバー側は撤去して一本化。ネイティブのカメラアプリで撮ったものを後から旅行に紐付ける主動線になる(記録中の撮影は画面下のバーの📷)。写真ライブラリ権限を増やす自動取り込みは採らなかった
  - Web は**閲覧のみ**(削除は iOS だけ)。CLAUDE.md の「揃えるのは表示情報で、操作は別」に沿った判断で、行が消えれば Web のメディアグリッド・地図マーカーからも消えるため表示は揃う
  - 検証: iOS 164 テスト成功(新規 `MediaDeletionTests`)/ Web lint + build / dev サーバへ curl で DELETE の 401・400・200・再送 404 / シミュレータ E2E(`MediaImportUITests` を「取り込み → 同期 → 長押しで削除 → 同期」まで拡張)。サーバ側は `media` 行 0 件・ファイルも 0 件まで確認
  - UI テストは旅行詳細がボトムシートになってから MEDIA セクションが遅延生成で見えないため、**シートを一番高い段へ上げてからリスト内をドラッグ**して目的の要素まで運ぶ `scrollToVisible` を入れた(画面下端は記録バーが浮いていてドラッグを吸うので、その手前から掴む)

## 2026-08-23

- iOS の記録・撮影を画面下の常駐バー(ミニプレイヤー相当)に出す [plan](docs/plans/archive/recording-status-bar.md)
  - 移動中の肝である GPS 記録と撮影が旅行画面のシートの奥(RECORD セクション)にしか無く、記録中かどうかも撮影も他の画面からは触れなかった。`ContentView` の `NavigationStack` の**外側**(`ZStack` 最前面)にバーを 1 つ置き、一覧・旅行画面・日詳細のどこに居ても状況が見えて 1 タップで撮影できるようにした
  - **表示条件**: 記録中は常時 / 記録していなくても進行中の旅行があれば常時 / 未終了の旅行を開いている間はその旅行が対象。どれでもなければ出さない。対象は **記録中 > 開いている旅行 > 進行中の旅行(開始が新しい方)** の順で決める(`Domain/RecordingBarState.swift` の純粋ロジック。16 テスト)
  - 「いま開いている旅行」は `Services/ActiveTripContext.swift` が持ち、各画面が `.activeTrip(trip)` で出し入れする。旅行 → 日詳細の遷移は `onAppear` / `onDisappear` の順序が保証されないため、画面ごとの鍵(UUID)で自分が入れた分だけを消す
  - バーの中身は 旅行タイトル / 記録中・経過時間・地点数・距離 / 📷 / ⏺⏹。経過時間は `TimelineView(.periodic(by: 60))` で分単位更新(秒更新は再描画とバッテリーの無駄)。取り込み中は「取り込み中…」、位置情報の拒否・エラー時は赤い文言でタップすると設定アプリへ
  - カメラの `fullScreenCover` は**バーと同じ階層に 1 つだけ**置く(旅行画面にも残すと同じ cover が二重になって片方が出なくなる)。カメラの無い環境(シミュレータ)は `PhotosPicker` に差し替わる。ライブラリ取り込みの重複コードは `MediaImporter.importPicked` に集約
  - **重なりの解消**: バーの高さを環境値 `\.recordingBarInset` で配り、一覧の下余白とシート(`SheetList`)の `safeAreaPadding` に足す。バーの面は `Theme.raised`(シートの `Theme.panel` に埋もれないよう一段持ち上げ)
  - 旅行画面の RECORD セクションは**バーに無い情報だけ**に整理(「画面を閉じても記録は続きます」「別の旅行を記録中です」、権限案内)。「旅行を終了」は後戻りできないのでバーには置かず詳細側に残した
  - iOS 固有の**操作**が増えるだけで表示情報(地点数・距離・記録中)は旅行詳細に既にあるものなので、Web 側の追従は不要(CLAUDE.md の情報を揃えるルール)
  - 検証: iOS ビルド + 159 テスト。シミュレータで一覧・旅行画面のバー表示、シートを最下部までスクロールしても最終行(旅行を削除)が隠れないこと、記録の開始・停止を目視。**実機での撮影・画面 OFF 復帰・権限拒否の確認は TODO に残した**(シミュレータにカメラが無いため)→ 2026-08-24 に実機で確認済み

- デザインを案 C「ルートキャンバス」に刷新する(iOS / PC-Web / Mobile-Web) [plan](docs/plans/archive/design-refresh.md)
  - 3 案(A: フィールドガイド / B: 旅の切符 / C: ルートキャンバス)を HTML モックで提示して **C を採用**。配色は**ダーク固定**(OS がライトでもダークで出す)。書体はプラットフォームに合わせ、iOS はシステムフォント、Web はシステムフォント + IBM Plex Mono(距離・時刻・座標の桁そろえ)。日本語 Web フォントは重いので使わない
  - **iOS**: 画面いっぱいの地図 + ボトムシートに作り替え(`Views/RouteSheet.swift` を新設)。SwiftUI の `.sheet` はシート内から `NavigationLink` で遷移できないため、`ZStack` に重ねる自前のシートにした(3 段階スナップ、つまみのドラッグ + タップで開閉)
  - **iOS の地図がダークにならない問題**: `preferredColorScheme(.dark)` は SwiftUI のビューにしか効かず MapKit はシステムの外観のままになる。`UIViewRepresentable`(`TripNoteApp.swift` の `DarkWindow`)で `window.overrideUserInterfaceStyle = .dark` を指定して解決
  - **iOS の一覧**: 行ごとに MapKit を並べると重いので、地図タイルを読まず座標の形だけを `Canvas` で描く `RouteThumbnail` を新設(記録があれば軌跡を 60 点に間引き、無ければプランのチェックポイント)。Web も同じ規則で `route-thumbnail.tsx`(SVG)
  - **Web**: PC は全面地図 + 左の固定パネル(440px)、モバイルは地図(sticky) + せり上がるパネル。日の見出しを押すとその日の範囲へ `fitBounds` で寄る(`trip-canvas.tsx` が選択状態を持つ)
  - **日カードのミニ地図は廃止**し、画面いっぱいの地図 1 枚に集約(iOS・Web とも)。`day-map.tsx` / `use-lazy-mount.ts` を削除。走行距離の計算には `dayMapPoints` を引き続き使う
  - **地図スタイル**: OpenFreeMap の `styles/dark` は陸地に塗りが無く、旅行全体のような低ズームでは一面が黒くなる。スタイルに含まれる Natural Earth の陰影(zoom 7 まで)を `withShadedRelief` で敷いて形が見えるようにした
  - **MapLibre の落とし穴 2 つ**: 加工したスタイルオブジェクトを複数の地図で使い回すと 2 つ目以降が読み込めない(内部で書き換えられる)ので `structuredClone` を地図ごとに渡す。またスタイルを URL でなくオブジェクトで渡すと `style.load` の購読前に読み込みが終わることがあるので `isStyleLoaded()` を見て直接呼ぶ
  - **表示情報を揃えた**: Web の一覧に総距離とプラン期間(「Sep 1 から 6 日間」)を追加(iOS の `TripRow` と同じ項目に)。一覧の集計は `lib/trip-list.ts` に集約し、記録点は 1 クエリでまとめて読む。チェックポイントの種別色は iOS(`CheckpointStyle.swift`)と Web(`checkpoint-style.ts`)で同じ値のダーク向けパレットへ
  - ルートの色分けは iOS・Web 共通で **記録済み = 緑の実線 / これから = 青の破線**。旅行全体の地図ではチェックポイントを小さな点にして、ピンが団子になるのを避けた
  - 検証: iOS ビルド + 144 テスト、シミュレータで一覧・旅行画面・日詳細を目視。Web は lint + build、Chrome で PC 幅の一覧・旅行詳細・設定・作成を目視(**モバイル幅はブラウザのウィンドウをリサイズできず未確認**)
  - 積み残し: Web のチェックポイントに到着予想時刻が無い(iOS の `ArrivalEstimator` 相当の移植が要るので TODO に分離)

- Web の地図にプランのルート(道路形状)を表示する [plan](docs/plans/archive/web-plan-route.md)
  - 道路ルーティング(OSRM プロキシ + `route_legs` キャッシュ)はサーバに実装済みだったが使っているのは iOS だけで、Web の地図にはプランのルート線が 1 本も無かった。iOS と同じレグ単位でルートを引き、日カードの距離も直線距離から道路距離へ差し替えた
  - `lib/route-legs.ts` を新設して `legKey` / `buildLegs` / `totalLegMeters` / `legLines` を集約(`routing.ts` は `node:net` と better-sqlite3 依存でクライアントから import できないため)。**キー規約は iOS の `Domain/RouteLegs.swift` と同じ**なので `route_legs` キャッシュを iOS と共有する。`routing.ts` の `legKey` はここへ移設し再エクスポート
  - **ブラウザから `/api/route` は叩かない**。Bearer は iOS 向けの契約なので、ページと同じ保護範囲(本番は Cloudflare Access)で動く Server Action `resolveRouteLegsAction` からサーバ内で `fetchRouteLegs()` を直接呼ぶ(`/api/*` の契約は不変)
  - `use-route-legs.ts` が解決を一手に引き受ける。モジュールスコープのキャッシュ(遅延マウントの日別地図が再マウントで取り直さない)+ 未解決キーを 8 件ずつ順に投げるキューで、**同時に走るリクエストは常に 1 本**。Next.js はクライアントごとに Server Action を直列にディスパッチするので、地図の枚数だけ投げると編集操作が待たされる
  - `readCachedLegs()`(**DB 参照のみ・OSRM を呼ばない**)で SSR 時点のキャッシュ済みレグを初期値として渡す。2 回目以降と iOS で先に見た旅行は最初の描画から道路形状になる
  - トップ地図は**破線**(`#2563eb` / 幅 3 / opacity 0.55 / `dasharray [2,2]`)で実績トラックの実線(幅 4)と区別。ルート用座標列は `checkpointMarkers` ではなく `planDays` から**日付順 → 日内 `sort_order` 順**で組む(前者は日をまたぐ順序が保証されない)
  - 日カードの走行距離は `dayDistanceMeters`(直線)を廃して `totalLegMeters`(解決済み = 道路距離 / 未解決 = 直線)に差し替え。混在の概算なので「約」は据え置き
  - **バグ修正**: ソース/レイヤの追加を `load` から **`style.load`** に変えた。`load` は**タイルが出そろうまで発火しない**ため、追加したルートが出ないままになることがあった(実際に再現。実績トラックにも同じ問題があった)
  - レグが解決しても地図は作り直さず `getSource(...).setData(...)` で差し替える(ちらつき防止)
  - 検証: web vitest 180 件(`route-legs` 14 件 + `readCachedLegs` 2 件を追加)+ lint + build。dev サーバで 12 日ぶんの道路形状、チェックポイント並び替えで新レグが直線 → 道路へ差し替わること(約 79.67km → 約 94.65km)、戻すとキャッシュから即描かれることを確認

- Web の日カードに距離と経由地を出す [plan](docs/plans/archive/web-day-distance-waypoints.md)
  - iOS の `TripDayRow` にある「🚗 約 N km」と「自宅 → 大涌谷 → 箱根湯本の宿」の 2 つが Web に無かった。表示情報を揃えたときに、経由地は「チェックポイント一覧があるので実質同等」と判断して見送り、距離は「レグ解決が要る」として先送りしていたが、どちらも日カードを見て分からないので出した
  - 距離は `lib/plan-map.ts` の `dayDistanceMeters`(前泊地起点 + 座標ありチェックポイントの**直線距離**)。iOS の `RouteLegDistance.totalMeters` は解決済みレグを道路距離・未解決レグを直線距離で足すので、**これは iOS がレグ解決前に表示するのと同じ値**。書式も iOS と同じ `%.2f km` で、常に「約」を付ける
  - レグが無い日(座標ありが 1 点以下)は距離を出さない(iOS の `legs.isEmpty` と同じ)
  - 経由地は**座標の有無に関わらず全チェックポイント**を ` → ` で連結し、`line-clamp-2`(iOS の `lineLimit(2)` 相当)。位置は iOS と同じくヘッダの下・地図の上
  - **道路距離への差し替えは `docs/plans/web-plan-route.md` の Step 4**。今は直線なので iOS の解決済み表示より小さい値が出る(例: 広島 → 東京 が直線 674km)
  - 検証: web vitest 168 件(`dayDistanceMeters` 4 件を追加)+ lint + build、dev サーバで 12 日ぶんの距離と経由地、座標なしの日に距離が出ないことを確認

- Web にも iOS と同じ編集操作を用意する [plan](docs/plans/archive/web-edit-operations.md)
  - 表示情報を揃えたときに残った「表示ではなく操作」の差 3 件。iOS でしかできず、Web を開いているときに直せなかった
  - `lib/plan.ts` に `updateTrip`(iOS `TripEditView.save` の移植)と `endTrip`(同 `LocationRecorder.endTrip`)を追加
    - `updateTrip`: タイトル必須・目的地は trim して空なら null・**移動手段は car に正規化**(古い旅行の null もここで揃う)。出発日時は**日付 + 時刻を表示 TZ の壁時計として解釈**する(`createTrip` と同じ `isoFromLocalWallClock`)。**プランの日付は動かさない**(1 日目の日付は作成時に決まる。iOS も同じ)
    - `endTrip`: `ended_at` を入れるだけ(Web は記録しない)。**進行中(started_at あり・ended_at なし)以外はエラー**にした(iOS もその条件でしかボタンを出さない)
  - UI は `edit-trip.tsx`(タイトル下の「旅行を編集」で開閉。項目は iOS と同じ)と `end-trip.tsx`(**進行中のときだけ**。`delete-trip.tsx` と同じ二段階確認 + iOS の footer 文言)
  - 日の出発時刻は `DayForm` に `<input type="time">` を追加(**空 = 未設定**。iOS の Toggle + DatePicker と同じ意味を素の input で表す)。`lib/plan.ts` の `updateTripDay` は対応済みだったので Action に通すだけ
  - 同期: `trips.updated_at` / `trip_days.updated_at` が進むので `/api/sync/pull` で iOS に流れる。スキーマ・API 契約の変更なし
  - 検証: web vitest 164 件(`updateTrip` 7 件・`endTrip` 2 件を追加。テスト治具 `seedTrip` に `ended_at` を追加)+ lint + build、dev サーバで 編集 → 反映 / 終了 → バッジとボタンが消える / 出発時刻の設定・クリア を確認

- 旅行画面・プランの Web 表示を iOS と同じ情報にする [plan](docs/plans/archive/web-ios-info-parity.md)
  - iOS(`TripDetailView` / `TripDayRow` / `TripDayDetailView` / `CheckpointRow`)と Web を項目単位で突き合わせ、iOS にしか出ていなかった情報を Web にも出した。対照表はプランファイルに残してある
  - チェックポイント行: 名前の下に**種別ラベル**(「観光」「宿泊」等)を出し、iOS と同じ「種別 · 予定時刻 · 座標未設定」の並びにした。文言も「位置未定」→**「座標未設定」**に統一
  - 日カード: 日付に**曜日**(`Sep 1 (火)`。iOS は日詳細で曜日まで出すが Web に日詳細は無いので日カードに集約)、**出発時刻**(`trip_days.departure_time`)、**「チェックポイントなし」**の空状態を追加
  - 旅行画面: メディア 0 件のときセクションごと消えていたのを**「写真・動画がありません」**に
  - `CLAUDE.md` に「**iOS と Web で表示情報を揃える**」を規約として明記(画面の対応・文言・空状態・操作は別、の 4 点)
  - 差分のうち**走行距離「約 N km」/ 到着予想「到着 HH:MM 頃」/ トップ地図の破線プランルート**はレグ解決が要るので `docs/plans/web-plan-route.md` に委ねた。**操作の差**(旅行の編集・旅行を終了・出発時刻の編集)は表示ではないので TODO に別項目として切り出した
  - 検証: web vitest 154 件(`formatDayWithWeekday` を追加)+ lint + build、dev サーバで種別ラベル・座標未設定・曜日・出発時刻・空状態(チェックポイントなし / 写真・動画がありません)を目視確認

- Web の日毎のプランに地図を表示する [plan](docs/plans/archive/web-day-plan-map.md)
  - 日カードがテキストだけで、その日の回り方が分からなかった(位置関係が見えるのはページ上部の全チェックポイント混在の地図 1 枚だけ)。iOS の `TripDayMiniMap` と同等の日別地図を Web にも出した
  - 表示データは `lib/plan-map.ts` の `dayMapPoints`(純ロジック・テスト付き)。座標が両方そろったチェックポイントだけを日内の順序のまま残し、ルートの起点(`anchor`)は iOS の `DayRoute.anchor(before:in:)` と同じく**それより前の日を逆順に見て最初に見つかった座標ありチェックポイント**(= 前泊地)
  - `day-map.tsx` は種別色のマーカー(`scale: 0.7`、名前は element の `title`)+ 訪問順の青いポリライン + 前泊地の小さな灰色の丸。`interactive: false` でページのスクロールを奪わない。ルート線はこの段階では**直線**(道路形状は `docs/plans/web-plan-route.md`)
  - `MAP_STYLE_URL` と `setWorkerUrl` の重複を `lib/maplibre-setup.ts` に共通化(`trip-map.tsx` / `outline-map.tsx` / `day-map.tsx` の 3 箇所)
  - WebGL コンテキスト対策として `use-lazy-mount.ts`(`IntersectionObserver`、`rootMargin: 100%`)で可視ぶんだけマウントする。**素早いスクロールでは 1 回のコールバックに複数の記録が届く**ので、先頭ではなく最後のエントリを見ること(先頭を見ると途中の状態を掴んで永久にマウントされない)
  - 検証: web vitest 152 件(`plan-map` を新設)+ lint + build、dev サーバに 12 日分の旅行を仕込んで各日の地図・前泊地からの線・座標ゼロの日に地図が出ないこと・スクロールしても同時に生きる地図が 5〜7 枚に収まることを確認(ダークモード)
  - なお **Chrome のタブが hidden(ウィンドウ最小化など)だと `IntersectionObserver` も maplibre の描画も止まる**ため、地図が真っ白なときはまずタブが前面にあるか疑う

- Web の日数・宿泊地候補にプレビュー地図を出す [plan](docs/plans/archive/web-outline-candidate-map.md)
  - 候補が文字だけでどこを回るのか分かりにくかったので、iOS の `OutlineCandidateMap` と同じく出発地 → 各泊 → 目的地をマーカー + ポリラインで結んだ操作不可の地図を候補カードに出す
  - 点列は `lib/outline-map.ts` の `outlineMapPoints`(純ロジック・テスト付き)。座標が無い点・片方だけの座標は飛ばす。出発地の座標は作成フォームで Google Maps のリンクから取れたときだけ付く
  - 地図は `trip-map.tsx` と同じ OpenFreeMap のスタイル・ワーカー指定で、`interactive: false` + `maxZoom` 控えめ。WebGL コンテキストを候補ぶん張るので**描くのは先頭 3 候補まで**
  - 途中で見つけた不具合を修正: `PlaceLink` が `<form>` を持っていたため、作成フォームやチェックポイント編集フォーム(どちらも `<form>`)の中に置くと **form の入れ子**になり、ブラウザが内側を落として「読み込む」で外側のフォームが送信 → ページがリロードされ入力が消えていた。`PlaceLink` を div + `onKeyDown` (Enter) に変更(チェックポイント編集側の同じ不具合も直る)
  - 検証: web vitest 146 件(`outline-map` を新設)+ lint + build、dev サーバで候補 2 件の地図(東京駅 → 松本 → 上高地)とリンク入力・チェックポイント編集のリンク入力を確認

- Web の旅行作成でも AI の日数・宿泊地候補ステップを出す [plan](docs/plans/archive/web-trip-outline.md)
  - Web で旅行を作っても 1 日目しかできず「作ったのに変化が見えない」状態だった(iOS は作成直後に trip_outline の候補ステップがある)
  - 採用処理 `adoptTripOutline` を `lib/plan.ts` に追加(Swift の `PlanEditor.adopt(_ candidate:into:)` の移植)。1 日目(既存の初日 ?? `departure_at` ?? 今日)から dayCount 分の日を揃え、最終日に目的地の到着チェックポイント、n 泊目を n 日目に宿泊チェックポイントとして末尾追記する。既存行の `updated_at` は進めない
  - 生成は同期呼び出しにせず iOS と同じ `ai_jobs` を使う(Cloudflare の 100 秒制限を避ける)。作成ボタンの延長でジョブを登録 → `after()` で生成 → クライアントが 3 秒間隔でポーリング
  - `/trips/new` に候補ステップ UI(候補の要約 + 泊の一覧・採用・スキップ・再試行)。iOS にある候補ごとのミニ地図は入れていない(maplibre の GL コンテキストを候補数ぶん張るため)
  - 旅行画面「AI で行程を提案」の出発地に 1 日目の出発チェックポイント名を初期値として入れた(iOS の `AIPlanSuggestView` と同じ。到着予定地は終点を書く欄なので空のまま)
  - API 仕様・スキーマの変更なし
  - 検証: web vitest 141 件(`adoptTripOutline` のケースを追加)+ lint + build、dev サーバで 作成 → 候補 → 採用 → 3 日分のプラン(1日目 出発 + 松本泊 / 2日目 上高地泊 / 3日目 到着)まで確認。ローカルは AI キーが無いため候補の JSON は治具で差し込み、キー未設定時のエラー + 再試行表示も確認した

- Web から旅行を作成できるようにする [plan](docs/plans/archive/web-create-trip.md)
  - これまで旅行の新規作成は iOS の `TripCreateView` だけで、Web は導線どころか作成処理自体が無かった(`insert into trips` は `/api/sync` と マイグレーションのみ)
  - `lib/plan.ts` に `createTrip` を追加。iOS の `PlanEditor.makeTrip` と同じく、プラン中の旅行(`started_at` は null、`transport` は car 固定)+ 出発日の 1 日目 + 出発地を入れたときだけ `departure` チェックポイント(`planned_time` = 出発日時、`sort_order` 0)を 1 トランザクションで作る
  - 出発日時は日付 (`YYYY-MM-DD`) と時刻 (`HH:mm`) を分けて送り、サーバ側で表示 TZ (America/Los_Angeles) の壁時計として ISO に変換する(ブラウザのローカル TZ で解釈すると入力した日付と 1 日目の日付がずれ得るため)。DST はオフセット差分で補正
  - `/trips/new`(作成フォーム + `createTripAction`)を新設し、トップに「旅行を作成」ボタンと空状態の文言修正を追加。出発地は既存の `PlaceLink` を再利用して Google Maps のリンクから座標も入れられる
  - スキーマ・同期は変更なし(`/api/sync/pull` が返し、iOS の `PlanPull.makeTrip` が未知の trip を新規作成する)
  - 残: 作成後の AI 日数・宿泊地候補ステップ(iOS の trip_outline 相当)は Web 未実装のため TODO に切り出し
  - 検証: web vitest 135 件(`createTrip` のケースを追加)+ lint + build、dev サーバでトップ → 作成 → 旅行画面(1日目 Aug 23 に出発「自宅」)まで手動確認

- プランの「N日目」の横の日付表示を揃える(Aug 25 形式) [plan](docs/plans/archive/plan-day-date-label.md)
  - 日付自体は iOS のプラン一覧・Web の日カード・AI 提案プレビューに既に出ていたが、書式がばらばら(iOS は端末ロケール依存の「8月25日(月)」、Web は「8/25(月)」)で、iOS の日詳細タイトルだけ日付が無かった
  - 書式は `Aug 25` に統一。ロケール依存で揺れないよう iOS は `en_US_POSIX` + `MMM d`、Web は `en-US` の `month: short` 固定。曜日と年は出さない(「N日目」と併記するラベルなので)
  - iOS: `PlanEditor.displayDate(_:)` を追加して一覧(`TripDayRow`)・AI 提案プレビューから共用し、日詳細のタイトルを「1日目 · Aug 25」に。日詳細の「日付」行は年つき(2026年8月25日(月))のまま残した
  - Web: `lib/format.ts` の `formatDay` を差し替え(呼び出し側は変更なし)。`trip_days.date` を表示 TZ でずらさない UTC 固定はそのまま
  - 検証: web vitest 129 件(`format.test.ts` を新設)+ lint + build、iOS ユニットテスト 144 件 + シミュレータビルド、ローカル dev のレンダリング確認(「1日目 Aug 21」)

- プランの途中の日を追加できる / 特定の日を削除すると後続が 1 日前にずれる [plan](docs/plans/archive/plan-day-insert-delete.md)
  - 日の順序は `trip_days.date` だけで決まる(順序カラム無し・「N日目」は並び順の index)ので、途中への差し込み・途中の削除は**後続の日の date を ±1 日ずらす**実装にした。`checkpoints.planned_time` は日付込みの絶対時刻なので同じ日数だけ一緒にずらす(`departure_time` は "HH:MM" なので触らない)
  - 共通ロジック: iOS `PlanEditor.shiftDays(after:by:)` / `insertedDay(after:)` / `deleteShiftingFollowing(_:)`、Web `lib/plan.ts` の `shiftDaysAfter` / `insertTripDayAfter` / `deleteTripDay`(削除に -1 日シフトを追加)。ずらした行だけ `updated_at` を進める(変わらない行を進めて LWW で他方の編集を潰さないため)
  - DST 対策: Web は `shiftIsoByDays`(24 時間加算した後に表示 TZ のオフセット差分で打ち消す)、iOS は `Calendar` の日加算。どちらも壁時計時刻(9:00 発)が保たれる
  - `trips.departure_at` は変更不要。「この日の後に追加」なので 1 日目より前に日が入らず、1 日目を削除した場合は後続が詰まって**新しい 1 日目が元の 1 日目の日付を引き継ぐ**
  - UI: Web は日カードのフッタに「+ この日の後に日を追加」、削除の確認文を「…以降の日は 1 日前にずれます」に(最終日では出さない)。iOS はプラン一覧の行にスワイプ操作(左: 次の日を追加 / 右: 削除 + 確認ダイアログ)を追加し、日詳細の「この日を削除」もシフト版に切り替え
  - スキーマ・`/api/sync`・API 仕様は変更なし(`date` / `planned_time` とも LWW upsert 済み)
  - 検証: web vitest 127 件(日付シフト・DST・tombstone の 12 件を追加)+ lint + build、iOS ユニットテスト 143 件(PlanEditor に 7 件追加)+ シミュレータビルド、Chrome でローカル dev の手動確認(1 日目の後に差し込み → 全 4 日にずれる / 2 日目を削除 → 連続した 3 日に戻る)。**iOS のスワイプ操作の実機・シミュレータ手動確認は未実施**

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
