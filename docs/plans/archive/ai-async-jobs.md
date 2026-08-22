# AI 生成のサーバ非同期化(ジョブ方式)

## 目的・背景

旅行作成直後の「日数・宿泊地候補」(trip-outline)や AI 行程提案(plan)の生成中に
アプリを切り替えると "The network connection was lost" が表示される。

原因: iOS は `URLSession.shared` で最大 300 秒の同期 HTTP リクエストを張りっぱなしに
しており(`Services/AIClient.swift`)、アプリがバックグラウンドへ移ると iOS が
ソケットを切断して `NSURLErrorNetworkConnectionLost`(-1005)になる。
生成処理自体は既にサーバ側(`web/src/lib/ai.ts`)だが、**結果を同一 HTTP 接続で
待ち続ける設計**が問題。長時間接続は Cloudflare Tunnel のタイムアウトにも弱い。

## 対応方針

ジョブ方式に変更する。クライアントはジョブを登録して即座に応答を受け取り、
以降は短いポーリングで結果を取得する。短いリクエストの繰り返しなら、
アプリ切替をまたいでも復帰後のポーリングで結果を受け取れる。

- 対象は生成に数十秒〜数分かかる `plan` と `trip_outline` の 2 種。
  `search-assist` は数秒で返るため同期のまま
- 既存の同期版 `POST /api/ai/plan` / `POST /api/ai/trip-outline` は旧クライアント
  互換のため残す(サーバ先行デプロイ時に旧アプリが動き続ける)。仕様書で互換用と明記
- Web 閲覧 UI(Server Action 直呼び)はブラウザのタブ切替で接続が切れないため対象外
- 「提案は DB に書かない。採用はクライアントが決める」という既存設計は維持する
  (ジョブの result はあくまで提案 JSON の置き場で、trip_days / checkpoints には書かない)

### サーバ(web/)

1. **マイグレーション 5: `ai_jobs` テーブル**

   ```sql
   create table ai_jobs (
     id text primary key,          -- クライアント発行 UUID(再送冪等)
     kind text not null check (kind in ('plan', 'trip_outline')),
     status text not null check (status in ('pending', 'running', 'succeeded', 'failed')),
     input text not null,          -- リクエスト JSON(バリデーション済み)
     result text,                  -- 成功時の提案 JSON
     error text,                   -- 失敗時のメッセージ
     created_at / updated_at       -- 既存テーブルと同じ default
   );
   ```

2. **`web/src/lib/ai-jobs.ts`(新規)**
   - `createAiJob({id, kind, input})`: kind に応じ `parsePlanInput` / `parseTripOutlineInput`
     でバリデーションして insert。同 id が既にあれば既存行を返す(冪等)。
     作成時に 7 日より古いジョブを削除(掃除)
   - `getAiJob(id)`: 取得。pending / running のまま `updated_at` が 10 分以上前の行は
     failed に落として返す(サーバ再起動でジョブが宙に浮いた場合の回収)
   - `runAiJob(id, generate?)`: `update ... set status='running' where id=? and status='pending'`
     で claim(0 行更新なら二重実行なので何もしない)→ `suggestPlan` / `suggestTripOutline`
     を呼び、succeeded + result または failed + error に更新。`generate` はテスト用の差し替え口

3. **API ルート(新規)**
   - `POST /api/ai/jobs`: Bearer 認証 → `createAiJob` → `after(() => runAiJob(id))` →
     `202 {"id", "status"}`。バリデーションエラーは 400、既存 id はその時点の状態を返す
   - `GET /api/ai/jobs/[id]`: Bearer 認証 → `{"id", "kind", "status", "result"?, "error"?}`。
     無ければ 404 `{"error":"not found"}`
   - `after()` は next/server の正式 API(Node サーバ / Docker で動作。応答送信後に
     コールバックを実行する)

### iOS(ios/)

4. **`Models/AIRecords.swift`**: ジョブ DTO を追加
   - `AIJobCreateRequest<Input: Encodable>`(id / kind / input)
   - `AIJobResponse<Output: Decodable>`(id / status / result? / error?)

5. **`Services/AIClient.swift`**: `suggestPlan` / `suggestTripOutline` の中身をジョブ方式に
   置き換える(シグネチャは不変 → View 側は変更不要)
   - `runAIJob(kind:input:)`: UUID を発行して `POST /api/ai/jobs` → 3 秒間隔で
     `GET /api/ai/jobs/{id}` をポーリング → succeeded で result を返す、failed で
     `AIServerError`、全体 10 分で打ち切り
   - ポーリング中の一時的なネットワークエラー(アプリ切替の瞬間など)は無視して
     継続する。サーバが明示的にエラーボディを返した場合(401 / 404 / failed)は即失敗
   - `searchAssist` は従来の同期 POST のまま

### 仕様書

6. **`docs/specs/server-api.md`**: `/api/ai/jobs` の仕様を追加。同期版
   `/api/ai/plan` / `/api/ai/trip-outline` は旧クライアント互換用と明記。
   クライアント構成(iOS)の節も更新

## 影響範囲

- web: `src/lib/db.ts`(マイグレーション追加)/ `src/lib/ai-jobs.ts`(新規)/
  `src/app/api/ai/jobs/route.ts`・`src/app/api/ai/jobs/[id]/route.ts`(新規)。
  既存ルート・Server Action・閲覧 UI は不変
- iOS: `Models/AIRecords.swift` / `Services/AIClient.swift` のみ。
  View(TripCreateView / AIPlanSuggestView)は不変
- 既存データへの影響なし(テーブル追加のみ)

## テスト方針

- web(vitest): `test/ai-jobs.test.ts` を新規作成。実 LLM API は呼ばず
  (既存 ai.test.ts と同方針)、`generate` を差し替えて検証する
  - createAiJob: バリデーション(kind / input)、冪等(同 id 再送)、古いジョブの掃除
  - runAiJob: 成功 → succeeded + result / 失敗 → failed + error / claim の二重実行防止
  - getAiJob: 未知 id / stale な running の failed 落とし
- iOS(xcodebuild test): `AIRecordsTests` にジョブ DTO のエンコード / デコードを追加。
  ポーリングは実機・シミュレータでの手動確認(生成中にアプリ切替 → 復帰で結果表示)
- `npm run lint` / `npm run build` / iOS ビルドの通過

## Phase

- Phase 1: サーバ — `ai_jobs` マイグレーション + `lib/ai-jobs.ts` + `/api/ai/jobs` ルート + vitest
- Phase 2: iOS — ジョブ DTO + AIClient のジョブ化(ポーリング)+ DTO テスト
- Phase 3: 仕様書更新(server-api.md)+ lint / build / 全テストで検証
