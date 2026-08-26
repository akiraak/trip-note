# 削除したチェックポイントが地図に表示されるバグ

## 目的・背景

削除したはずのチェックポイントが地図にピンとして残る。2026-08-25 のヒアリングで分かった症状:

- 出るのは **Web の旅行ページの地図** と **iOS の旅行画面の地図**
- **一覧（プランの日カード / チェックポイント一覧）からは消えている**。地図にだけ残る
- 削除操作をどちら（iOS / Web）で、地点単体で消したか日ごと消したかは不明

「一覧から消えて地図にだけ残る」という差が出るのは、**一覧と地図で見ているチェックポイントの集合が違う**から。
本調査ではその差と、差を生むデータ（親の日が削除済みなのに生きているチェックポイント = 以下 **孤児 CP**）の発生源を洗い出す。

## 現状の整理: どの画面がどの集合を見ているか

| 画面 | 出どころ | tombstone の除外条件 |
| --- | --- | --- |
| Web 旅行詳細 **地図のピン** | `page.tsx:72-77` → `checkpointMarkers`（`page.tsx:132-140`） | `c.deleted_at is null` のみ。**親の日を見ていない** |
| Web 旅行詳細 **日カード**（一覧） | `page.tsx:67-99` `planDays`（生きている日ごとに振り分け） | 日・CP の両方 |
| Web 旅行詳細 **プランの破線ルート** | `page.tsx:143-150` `planRoute`（`planDays` 由来） | 日・CP の両方 |
| Web 一覧のミニ地図 | `trip-list.ts:84-90` | `join trip_days` + `d.deleted_at is null`。**日も見ている** |
| iOS 旅行画面の地図 | `TripDetailView.swift:529-533`（`upcomingDays` → `day.sortedCheckpoints`） | 日・CP の両方（日経由） |
| iOS 日詳細の地図 | `TripDayDetailView.swift:274-276` | 日・CP の両方（日経由） |

**Web の旅行詳細だけ、地図のピンが日の tombstone を無視している。** 同じ Web でも一覧のミニ地図は日を join しているので、
旅行詳細のクエリだけが揃っていない。孤児 CP があると「Web の旅行ページの地図にだけピンが残り、日カードにもルートにも出ない」
という報告どおりの症状になる。

## 原因の仮説

### H1（本命・Web 側）: 孤児 CP が旅行詳細の地図にだけ出る — **2026-08-25 実証済み**

`checkpoints.deleted_at is null` かつ親の `trip_days.deleted_at is not null` の行が、Web 旅行詳細の地図にだけ残る。
ローカル開発 DB（`web/data/trip-note.db`）は孤児 0 件・日の tombstone 0 件だったので、孤児を 1 件作って確認した
（確認後に DB は元へ戻し済み）:

1. 「日別地図の確認用」旅行の 5 日目（`…day-d4` / 2026-09-05、チェックポイント「岐阜の宿」1 件・座標あり）の
   **日だけ** を tombstone にした（CP は `deleted_at is null` のまま = 孤児 CP）
2. `npm run dev` で旅行詳細ページを取得して RSC ペイロードを見た結果:
   - 削除した日の日カードは**消えている**（`2026-09-05` の出現 0 件）
   - なのに `TripCanvas` へ渡る**地図マーカーの配列にだけ「岐阜の宿」が残っている**
     （`{"id":"…day-d4-c0","type":"lodging","name":"岐阜の宿","latitude":35.4233,"longitude":136.7606}`）
   - `planRoute`（破線ルート）には入っていない（座標の出現は 1 回だけ）

**= 一覧からもルートからも消えているのに、地図のピンだけ残る。** 報告された症状と一致する。

### H2: 孤児 CP の発生源（同期の親子整合）

削除は tombstone + 行単位 LWW（`updated_at` の新しい方が勝つ）で伝搬する。親子をまたぐ整合は誰も保証していない:

- **(a) LWW の競合で子だけ復活する**: Web で日を削除（日と CP を tombstone）→ iOS がその CP をローカルで編集（`updated_at` が
  Web の削除より新しい）→ 次の同期の pull では CP の tombstone が LWW で負け（`PlanPull.swift:45`）、続く push で
  `deleted_at = excluded.deleted_at` により**サーバの CP が生き返る**（`api/sync/route.ts:212-229`）。
  親の存在チェック `dayExists`（`route.ts:238, 281`）は tombstone の日も通してしまう。
- **(b) push の順序と失敗**: `SyncEngine.syncNow()` は trips → days → checkpoints の順に送る（`SyncEngine.swift:60-63`）。
  日の tombstone だけ届いて CP の push が失敗すると、次の同期までサーバは孤児状態になる。
- **(c) 関連の切れた CP の tombstone が永久に届かない**: `CheckpointRecord.init?` は `trip` / `tripDay` が nil だと nil を返す
  （`SyncRecords.swift:183-184`）。`pushCheckpoints` は送れなかった行も含めて `needsSync` を下ろす（`SyncEngine.swift:184-186`）
  ため、その CP の削除はサーバへ二度と伝わらない。

### H3（iOS 側）: ローカルでも削除が LWW で負けて残っている

H2(a) の裏返しで、iOS のローカル DB に「削除したはずの CP」が生き残ることがある。iOS の地図は日経由なので孤児 CP は出ないが、
**CP 自身が生きている**なら地図に点として出る。旅行画面の一覧（日行）は CP 名を `→` で連結し 2 行で切っている
（`TripDetailView.swift:612-621`）ので、一覧では気づきにくい。「iOS でも地図だけに残って見えた」という観察と整合する。

### H4（保険）: SwiftUI Map の更新漏れ

iOS の旅行画面は `compactCheckpoints = true` の `Annotation`（`TripMapView.swift:184-202`）を使う。削除直後だけピンが残り、
画面を開き直す / アプリを再起動すると消えるなら、データではなく Map の差分更新側の問題。H3 との切り分けは再起動で行う。

## 対応方針

### Phase 1: 再現条件の確定

1. **[済 2026-08-25]** ローカルで孤児 CP を作り、Web 旅行詳細の地図にだけ出ることを確認した（H1 の節を参照）
   ```sh
   # 孤児の有無を数える(本番でも同じ SQL で確認できる)
   sqlite3 web/data/trip-note.db \
     "select count(*) from checkpoints c join trip_days d on d.id = c.trip_day_id
      where c.deleted_at is null and d.deleted_at is not null;"
   ```
2. **[未]** ユーザーに Web の地図で残っているピンをクリックしてもらい、**名前と種別を控える**。その名前が
   Web の日カード / iOS の日詳細に無いことを確認する（= 孤児 CP か、iOS ローカルだけの生き残りかを判定）。
   Phase 2 の修正で Web からピンが消えれば孤児 CP だったと後追いでも確定できるので、必須ではない
3. **[未]** iOS シミュレータで「日詳細で CP をスワイプ削除 → 戻る → 旅行画面の地図」を見る。
   残るなら**アプリを再起動して**消えるか確認する（消えれば H4、残れば H3）。
   実行前に `ios/TripNote/Resources/ServerConfig.plist` をローカル向きへ差し替える
   （既定は本番向きのため、シミュレータの操作が本番へ同期されてしまう）

### Phase 2: Web の表示を揃える（H1 の直接の修正） — **2026-08-25 完了**

- プランの読み出しを `web/src/lib/trip-plan.ts`（新規）の `readTripPlan()` に切り出した。
  チェックポイントは `join trip_days` + `d.deleted_at is null` で引き（`trip-list.ts:84-90` と同じ形）、
  **日カード・地図のピン・破線ルートを 1 つの集合から組み立てる**
- `page.tsx` はその戻り値を渡すだけにした。`PlanCheckpoint` / `PlanDay` の型は `lib/trip-plan.ts` が正となり、
  `plan-section.tsx` は再エクスポートするだけ（既存の import 元はそのまま）
- テスト `web/test/trip-plan.test.ts`（6 件）を追加。孤児 CP・tombstone・座標なし・並び順・旅行の取り違えを押さえた
- 確認: Phase 1 と同じ手順で孤児 CP を作り直し、修正後のページからは**ピンも座標も消えた**
  （日カードは元から出ない）。`npm test`(206 件) / `npm run lint` / `npm run build` すべて通過

### Phase 3: 孤児 CP が生まれないようにする（H2 / H3） — **2026-08-25 完了**

**tombstone を LWW の外に出し、2 つの不変条件をサーバと iOS の両方で守るようにした。**
削除の取り消し操作は iOS・Web とも無いので、これで表示できる行が減ることはない。

1. **一度付いた `deleted_at` は解除しない**
   - Web: 3 つの upsert を `deleted_at = coalesce(<table>.deleted_at, excluded.deleted_at)` に
   - iOS: `PlanPull.apply` を `deletedAt = <ローカル>.deletedAt ?? record.deletedAt` に
2. **親が削除済みなら子も削除済み**
   - Web: 受信行の `deleted_at` が null でも親（trip / day）の値を継がせる。さらに親が tombstone に
     なったら、サーバに残っている生きた子を道連れにする（子の tombstone が LWW で負けた・そもそも
     送られてこなかった場合の取りこぼし対策。`updated_at` はサーバ時刻にして必ず次の pull で配る）
   - iOS: `PlanPull.makeDay` / `makeCheckpoint` が親の tombstone を継ぐ。`PlanPull.cascadeDelete(in:)` を
     足し、`SyncEngine.applyPull` の日ループから呼んでローカルに残った生きた CP を道連れにする
     （`needsSync` を立ててサーバへも伝える）

- テスト: `web/test/sync.test.ts` に 4 件、`ios/TripNoteTests/PlanPullTests.swift` に 4 件追加。
  Web 210 件 / iOS 216 件すべて通過
- H2c（`pushCheckpoints` が送れなかった CP の `needsSync` を下ろす）は**現状維持**とした。
  関連の切れた CP もサーバ側で親の tombstone を継ぐようになって実害が消えたのと、
  送り続けるループを避ける今の挙動に意味があるため

### Phase 4: 既存データの掃除 — **2026-08-25 完了**

- `web/src/lib/db.ts` の `MIGRATIONS` に、親が削除済みなのに生きている日・チェックポイントを
  tombstone にする更新を追加した（`updated_at` も進めて iOS の pull へ伝える）
- 確認: ローカル DB に孤児を 1 件作ってページを開き、`user_version` が上がって孤児が 0 件になることを見た
  （確認後、DB は元のバックアップと `.dump` 単位で一致するところまで戻した）
- **本番（g3plus）は次回デプロイ時にこのマイグレーションが走って掃除される**

### Phase 6: 本番の実データで見つかった「削除が片方に届かない」欠陥 — **2026-08-25 完了**

ユーザー報告（iOS の「五大湖」3 日目、Spearfish, SD の後に削除したはずのホテルが残る）を
本番の `/api/sync/pull`（tombstone 込みで全件返る）で突き合わせた結果:

| 行 | 日 | サーバの状態 |
| --- | --- | --- |
| `ラピッドシティ市街のホテル` | 3 日目 (8/27) | **削除済み** 2026-08-24T05:49:11Z |
| `Rapid City, SD` | 3 日目 (8/27) | **削除済み** 2026-08-24T22:43:53Z |
| `ラピッドシティ ダウンタウン周辺のホテル` | 9 日目 (9/2) | 生存（別の行。Web の 9 日目に正しく出ている） |

- **サーバ側は正しく、孤児 CP も 0 件**。Web の 3 日目には何も残っていない
- つまり **iOS のローカルだけが削除を取り込めていない**（H3）

原因は Phase 3 で入れた規則の**逆方向が抜けていた**こと。`PlanPull.apply` も `/api/sync` の upsert も
`updated_at` の新しい方が勝つため、**受け側の `updated_at` が進んでいると（ローカルで並べ替え・編集をした等）
相手の削除が LWW で負け、永久に取り込まれない**。しかも pull は `updated_at > since` の行しか返さないので、
一度取りこぼした削除は二度と配られない。

対応（「削除は常に勝つ」を両方向で徹底）:

- iOS `PlanPull.apply`（trip / day / checkpoint）: LWW の `guard` より**前**に tombstone を取り込む。
  レコードが古くても削除だけは反映し、ローカルの tombstone は解除しない
- Web `/api/sync`: 受信行が tombstone なら `updated_at` の新旧に関係なく `deleted_at` を立てる
  （`updated_at` はサーバ時刻にして、次の pull で他クライアントへ配り直す）
- マイグレーション追加: **既存の tombstone 行の `updated_at` を進めて配り直す**。
  これで、クライアントが取りこぼした削除（今回の 2 件を含む）が次の同期で解消する
- テスト: Web 1 件 / iOS 2 件追加（Web 211 件・iOS 218 件すべて通過）

### Phase 5: iOS の地図更新漏れ（Phase 1-3 で消えなければ）

- `TripMapView` の `ForEach` / `Annotation` の差分更新対策（annotation を値型で `Equatable` にする、`id` を明示するなど）

## 影響範囲

- Web: `src/app/trips/[id]/page.tsx`、`src/app/api/sync/route.ts`、`src/lib/db.ts`（マイグレーション）、切り出し先の `src/lib/`
- iOS: `Domain/PlanPull.swift`、`Services/SyncEngine.swift`、（Phase 5 なら）`Views/TripMapView.swift`
- 表示する情報そのものは増減しないので、iOS / Web の情報対応（`docs/plans/archive/web-ios-info-parity.md`）は変わらない

## テスト方針

- Web: 旅行詳細の地図データに孤児 CP が出ないユニットテスト（Phase 2 の切り出し先に対して）
- Web: `web/test/sync.test.ts` に「親の日が tombstone のとき、CP を `deleted_at: null` で push しても復活しない」ケースを足す
- iOS: `TripNoteTests/PlanPullTests.swift` に同じ不変条件のテスト（unmanaged なエンティティで書く）
- 実機確認: Phase 1 の再現手順で、修正後に地図からピンが消えることを iOS / Web の両方で見る

## 未確定事項

- 削除操作の場所（iOS / Web、地点単体 / 日ごと）はユーザーの記憶になし → Phase 1 の実測で埋める
- 本番（g3plus）の孤児 CP 件数は今回見ない方針。Phase 4 の掃除で結果的に解消される見込み
