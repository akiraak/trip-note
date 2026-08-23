# 日カードに距離と経由地を出す(Web)

## 目的・背景

Web の旅行画面のプランで、各日に**走行距離**と**経由地(チェックポイント名の並び)**が出ていない。
iOS の `TripDayRow` はどちらも出している。

```
1日目  Sep 1   🚗 約 100 km          ← 距離
東京 → 箱根                          ← 行程タイトル(Web も出ている)
自宅(渋谷) → 大涌谷 → 箱根湯本の宿    ← 経由地(Web に無い)
[ミニ地図]
```

表示情報の突き合わせ(`docs/plans/archive/web-ios-info-parity.md`)では、
経由地は「Web はチェックポイントを一覧表示しているので実質同等」と判断して見送り、
距離は「レグ解決が要る」として `web-plan-route.md` に委ねていた。どちらも実際には
**日カードを見たときに分からない**ので、ここで出す。

## 対応方針(Web の表示のみ。DB スキーマ・API・同期契約・iOS は変更なし)

### 距離の出し方(直線距離ベースの概算)

iOS の `RouteLegDistance.totalMeters(legs:resolved:)` は
**解決済みレグは道路距離・未解決レグは直線距離(Haversine)** を足す。
つまり**直線距離は iOS 自身が未解決時に表示している値**で、常に「約」を付けている。

Web はまだレグを解決していない(`docs/plans/web-plan-route.md` の担当)ので、
**全レグを未解決とみなした直線距離**を出す。iOS のフォールバックと同じ計算・同じ「約」表記で、
道路距離になったら値が上がる、という関係になる。

- 対象は**前泊地(anchor)起点 + その日の座標ありチェックポイント**(日別地図で線を引くのと同じ点列)
- 座標ありが 1 点以下(= レグが無い)の日は距離を出さない(iOS も `legs.isEmpty` で出さない)

### Step 1: `lib/plan-map.ts` に `dayDistanceMeters`

`DayMapData`(`{ points, anchor }`)から距離を出す純関数を足す。既存の
`lib/geo.ts` の `totalDistance`(Haversine)をそのまま使う。テスト対象。

### Step 2: 日カードに 2 行を足す

`plan-section.tsx` の `DayCard`:

- ヘッダに **`🚗 約 N km`**(`formatDistance`。レグが無い日は出さない)
- ヘッダの下・地図の上に **経由地**(`day.checkpoints` の名前を ` → ` で連結)
  - iOS と同じく**座標の有無に関わらず全チェックポイント**を並べる
  - 長い日があるので 2 行でクランプする(iOS の `lineLimit(2)` 相当)
  - チェックポイントが 0 件の日は既存の「チェックポイントなし」のまま(重複させない)

## 影響範囲

- web(変更): `src/lib/plan-map.ts` / `src/app/trips/[id]/plan-section.tsx`
- DB スキーマ・`/api/*`・同期契約・iOS: 変更なし
- デプロイ: 通常の rebuild のみ

## テスト方針

- vitest: `dayDistanceMeters`(前泊地を含む / 含まない、点が 1 つ以下なら 0、座標なしを飛ばす)
- `npm run lint` / `npm run build`
- 手動(`npm run dev`): 距離と経由地の表示、座標が 1 点以下の日に距離が出ないこと

## スコープ外

- **道路形状のルートに基づく距離**(値が iOS の解決済み表示と一致するようにすること) →
  `docs/plans/web-plan-route.md`(Step 4 で日毎の距離を道路距離に差し替える)
- 到着予想「到着 HH:MM 頃」 → 同上
