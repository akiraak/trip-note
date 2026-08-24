# 旅行ページの TIMELINE を消す

## 目的・背景

旅行詳細の TIMELINE は GPS の記録点をそのまま全件並べたもので、
長時間記録した旅行では数百行になり、読み物としての価値がない
(同じ点は地図の軌跡として描かれており、件数と総距離は統計に出ている)。
iOS・Web の両方から表示を消す。

## 対応方針

- **表示だけを消す**。記録点のデータ(location_points)・同期・地図の軌跡・
  地点数/総距離の統計はそのまま残す
- iOS と Web を**同じコミットで**消す(片方だけ情報が減らないようにする =
  CLAUDE.md の「iOS と Web で表示情報を揃える」)

## 影響範囲

- `ios/TripNote/Views/TripDetailView.swift`: `timelineSection` とシートからの呼び出し、
  行を描くだけの `PointRow` を削除
- `web/src/app/trips/[id]/page.tsx`: Timeline セクションの markup を削除
  (points の取得は距離計算と地図に使うので残す)

## テスト方針

- iOS: ビルド + 既存テスト一式
- Web: `npm run lint` + `npm run build`、ブラウザで旅行詳細に TIMELINE が
  出ないこと・地図と統計が変わらないことを目視
