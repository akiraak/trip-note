# デザイン刷新（iOS / PC-Web / Mobile-Web）

## 目的・背景

現在の UI は「動くこと」を優先した素の状態で、見た目の方針が決まっていない。

- **iOS**: SwiftUI の標準 `List` + `Section` そのまま。色はシステム標準、タイポの階層もほぼ既定値。
  旅行一覧（`ContentView`）・旅行詳細（`TripDetailView`）・日詳細（`TripDayDetailView`）が
  すべて同じ見た目で、地図・プラン・記録・メディア・タイムラインが等価に並んでいる。
- **Web**: Tailwind の初期状態（zinc グレー + Geist）。`max-w-2xl` の 1 カラムで、
  PC でもモバイル幅と同じ縦積みのままなので、広い画面が活きていない。

旅行アプリとして「プラン（日程）と地図」が主役になる見た目に作り替える。
iOS と Web で**同じデータを同じ意味で見せる**という既存ルール（CLAUDE.md「iOS と Web で表示情報を揃える」）は
デザインを変えても維持する。**見た目を変えても、表示する情報項目は減らさない**。

## 進め方

デザインの方向性を先に決めてから実装する。

- **Phase 0: デザイン案を 3 パターンずつ作って選ぶ**（完了）
  - iOS 3 案: https://claude.ai/code/artifact/edc3d2c8-89f2-4f67-bcf6-6bba80f2ad56
  - Web 3 案: https://claude.ai/code/artifact/7da77c45-9ab5-4b5e-869f-1133f2888b19
  - **決定（2026-08-23）: 案 C「ルートキャンバス」を iOS / Web ともに採用。配色はダーク固定**
    （OS のライト設定でもダークで出す。地図も iOS = MapKit のダーク、Web = OpenFreeMap `styles/dark` に統一）
  - 書体はプラットフォームに合わせる: iOS = システムフォント（数値は monospaced digits）、
    Web = M PLUS 1 + IBM Plex Mono。日本語フォントの埋め込みはアプリサイズが増えるので iOS ではしない
  - モックは「旅行一覧」「旅行詳細（プラン）」「日詳細」の実データ相当（シアトル → シカゴ）で作る
  - 採用案が決まったら、この節に決定を追記してから Phase 1 へ進む
- **Phase 1: iOS を採用案に合わせる**
- **Phase 2: Web（PC / モバイル）を採用案に合わせる**

Phase 1 と Phase 2 は同じ情報を出す前提なので、片方だけ先に進めても
表示項目の増減は起こさない（表示項目を変える場合は両方同じコミットで揃える）。

## デザイン案（Phase 0 で提示する 3 パターン）

3 案は「どこまで作り替えるか」の幅で分けている。案の番号は iOS / Web で対応しており、
組み合わせて選んでもよいし、片方だけ別の案にしてもよい。

### 案 A: フィールドガイド（構造は保ったまま整える）

- **考え方**: 画面構成は今のまま。配色・タイポ・余白・カードの見せ方を整理して読みやすくする
- **配色**: インク `#1B2430` / 地 `#FFFFFF`・`#F4F6F8` / アクセント（濃いティール）`#0E6E8C` /
  種別色は既存（出発=緑・到着=赤・観光=橙 …）を踏襲
- **書体**: Zen Kaku Gothic New（見出し・本文）+ IBM Plex Sans（距離・時刻などの数値、tabular）
- **レイアウト**: iOS は inset grouped list のまま、日を情報カード化。
  Web は PC で 2 カラム（左＝日程、右＝地図をスティッキー固定）、モバイルは 1 カラム
- **実装コスト**: 小。既存のビュー構造をほぼ維持できる

### 案 B: 旅の切符（紙のきっぷ・スタンプ帳）

- **考え方**: 1 日 = 1 枚の券片。日付・区間（起点 → 終点）・走行距離を券面のように組む
- **配色**: 券紙 `#EAE7DC` / インク（濃紺）`#1F2E4A` / 検札の朱 `#C1462E` / 藍 `#2C5F7C`
- **書体**: Shippori Mincho B1（日付・見出し）+ Zen Kaku Gothic New（本文）+ Archivo（券番号・数値）
- **レイアウト**: 日カードはミシン目付きの券片。チェックポイントは券面の下段に順番に刻む。
  地図は券片の中に小さく収める。Web PC は券片を 2 列に並べて右に全体地図
- **実装コスト**: 中。iOS は `List` の背景を外して自前のカードを並べる

### 案 C: ルートキャンバス（地図が主役）

- **考え方**: 地図を全面に置き、プランは上に重ねたパネル / シートで読む
- **配色**: ダーク基調（地 `#101419` / パネル `#1A222B`）+ ライトも用意。
  ルートは走行済み `#7BD389` → 予定 `#5AA9E6` の 2 色で区別
- **書体**: M PLUS 1（UI）+ IBM Plex Mono（座標・距離・時刻）
- **レイアウト**: iOS は地図全画面 + ボトムシート（`presentationDetents` の 3 段階）。
  Web PC は全面地図 + 左サイドパネル（固定幅）、モバイルはドラッグ可能なシート
- **実装コスト**: 大。画面遷移の作り（日詳細への遷移、シート内スクロール）から変わる

## 影響範囲

### iOS

- `ios/TripNote/ContentView.swift`（旅行一覧・同期セクション）
- `ios/TripNote/Views/TripDetailView.swift`（旅行詳細・日カード・ミニ地図）
- `ios/TripNote/Views/TripDayDetailView.swift`（日詳細・チェックポイント行）
- `ios/TripNote/Views/TripMapView.swift`（地図のピン・ルートの見た目）
- `ios/TripNote/Views/CheckpointStyle.swift`（種別の色・アイコン。案 B / C では調整）
- 案 C を採る場合は `TripCreateView` / `CheckpointEditView` などシート類も追従

### Web

- `web/src/app/globals.css`（トークン: 配色・フォント変数）、`web/src/app/layout.tsx`（フォント読み込み）
- `web/src/app/header.tsx`、`web/src/app/page.tsx`（旅行一覧）
- `web/src/app/trips/[id]/page.tsx`（旅行詳細のレイアウト。PC 2 カラム化はここ）
- `web/src/app/trips/[id]/plan-section.tsx`（日カード・チェックポイント行）
- `web/src/app/trips/[id]/trip-map.tsx` / `day-map.tsx`（地図スタイル・ルート色）
- `web/src/lib/checkpoint-style.ts`（種別の色。iOS 側と対で変更する）

## 表示情報の維持（デザイン変更で落とさないもの）

刷新後もこれらは iOS・Web 両方に残す（`docs/plans/archive/web-ios-info-parity.md` の対照表が正）。

- 旅行: 状態バッジ（記録中 / 進行中 / プラン中）、開始・終了、出発予定、目的地、地点数、総距離
- 日: 日目 + 日付（曜日）、出発時刻、走行距離「約 N km」、行程タイトル、メモ、経由地の連結表示
- チェックポイント: 種別アイコン・種別ラベル・予定時刻 or 到着予想「HH:MM 頃」・「座標未設定」・メモ
- 空状態: 「チェックポイントなし」「写真・動画がありません」「位置情報がありません」「未出発」

## 実装で分かったこと（Phase 1 / 2 の記録）

- **iOS のダーク固定**: `preferredColorScheme(.dark)` は SwiftUI のビューにしか効かず、MapKit の地図は
  システムの外観のままになる。`UIViewRepresentable` で `window.overrideUserInterfaceStyle = .dark` を
  指定して初めて地図もダークになる（`TripNoteApp.swift` の `DarkWindow`）
- **iOS のシート**: SwiftUI の `.sheet` はシート内から `NavigationLink` で押せないため、
  `ZStack` に重ねる自前のボトムシート（`Views/RouteSheet.swift`）にした。3 段階のスナップ、
  つまみのドラッグ + タップで開閉
- **Web の地図スタイル**: OpenFreeMap の `styles/dark` は陸地に塗りが無く、旅行全体のような
  低ズームでは一面が黒くなる。スタイルに含まれる Natural Earth の陰影（zoom 7 まで）を
  敷いて形が見えるようにした（`lib/maplibre-setup.ts` の `withShadedRelief`）
- **MapLibre のスタイルオブジェクト**: 加工したスタイルを複数の地図で使い回すと
  2 つ目以降が読み込めない（内部で書き換えられる）。地図ごとに `structuredClone` を渡す。
  あわせて、スタイルをオブジェクトで渡すと `style.load` の購読前に読み込みが終わることがあるので
  `isStyleLoaded()` を見て直接呼ぶ
- **日ごとのミニ地図は廃止**: 画面いっぱいの地図 1 枚に集約し、日を選ぶとその日へ寄る形にした
  （iOS = 日詳細へ遷移、Web = 日の見出しを押すと fitBounds）。iOS・Web どちらも同じ扱い

## 残っている差分

- Web のチェックポイントに**到着予想時刻**が無い（iOS は `ArrivalEstimator` で「到着 HH:MM 頃」を出す）。
  デザイン変更ではなくロジックの移植が要るので別タスクにした（TODO.md）
- 「記録中」バッジは iOS だけ（記録状態はローカル専用で同期していないため。仕様どおり）

## テスト方針

- iOS: `xcodebuild ... test` が通ること（デザイン変更でロジックは変えない）。
  シミュレータで一覧 → 旅行詳細 → 日詳細を目視確認（ライト / ダーク両方）
- Web: `npm run lint` / `npm run build`。PC（1280 幅）とモバイル（390 幅）で目視確認、
  ダークモードも確認
- 情報パリティ: 上記「表示情報の維持」のチェックリストを iOS / Web 双方で突き合わせる
