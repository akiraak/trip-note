# 「手入力で追加」を「テキストを追加」に変更する

## 目的・背景

チェックポイントの追加ボタンが「Google Maps のリンクから追加」と「手入力で追加」の 2 つに
なったが、「手入力」が何を指すのか分かりにくい(リンクを手で貼るのも手入力に読める)。
実際にやることは「名前などをテキストで打ち込んで追加する」なので、**「テキストを追加」**に
言い換える。

## 対応方針

ユーザーに見える文言だけを変える。フォームの中身・モード名・データ構造は変更しない。

| 箇所 | 変更前 | 変更後 |
| --- | --- | --- |
| Web `plan-section.tsx` | `+ 手入力で追加` | `+ テキストを追加` |
| Web `plan-section.tsx`(開いているとき) | `手入力を閉じる` | `テキスト入力を閉じる` |
| iOS `TripDayDetailView.swift` | `手入力で追加` | `テキストを追加` |

- Web の「閉じる」側は、隣の「リンク入力を閉じる」と揃えて「テキスト入力を閉じる」にする
- `checkpoint-form.tsx` 冒頭のコメント「チェックポイントの追加(手入力)」も
  UI と合わせて「(テキスト入力)」に直す
- 内部の `mode === "add-manual"` / `showsManualAdd` はそのまま(表示文言のみの変更)
- 予定時刻の「手入力 plannedTime」など**別の意味の「手入力」**(`ArrivalEstimator` /
  `PlanEditor` / `TripCreateView` のコメント)は触らない

## 影響範囲

- web: `src/app/trips/[id]/plan-section.tsx`(表示文言)、`checkpoint-form.tsx`(コメント)
- iOS: `TripNote/Views/TripDayDetailView.swift`(ボタンのラベル)
- API・DB・同期・env・compose の変更なし。`project.yml` の変更なし
  (ファイルの追加・削除が無いので `xcodegen generate` は不要)

## テスト方針

- web: `npm run lint` / `npm run build` / `npm test`(文言を検証しているテストは無い)
- iOS: `xcodebuild build` / `test`
- 目視: Web の日カードのボタンが「+ Google Maps のリンクから追加 / + テキストを追加」に
  なり、開くと「テキスト入力を閉じる」になること。iOS の日詳細も同様
