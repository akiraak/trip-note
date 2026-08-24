import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// スキーマの正。変更は末尾に新しいマイグレーションを追加する
// (PRAGMA user_version = 適用済みマイグレーション数)
const MIGRATIONS: string[] = [
  `
  create table trips (
    id text primary key,
    title text not null,
    started_at text not null,
    ended_at text,
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  create index trips_started_idx on trips (started_at desc);

  create table location_points (
    id text primary key,
    trip_id text not null references trips (id) on delete cascade,
    latitude real not null,
    longitude real not null,
    altitude real,
    accuracy real,
    recorded_at text not null,
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  create index location_points_trip_recorded_idx on location_points (trip_id, recorded_at);

  create table media (
    id text primary key,
    trip_id text not null references trips (id) on delete cascade,
    location_point_id text references location_points (id) on delete set null,
    type text not null check (type in ('photo', 'video')),
    storage_path text not null,
    taken_at text not null,
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  create index media_trip_taken_idx on media (trip_id, taken_at);
  `,
  // trips を「記録の単位」から「旅行」に昇格する:
  //   started_at nullable 化(プラン段階では未出発)/ transport(移動手段。AI 行程提案の入力)/
  //   deleted_at(tombstone。双方向同期の削除伝搬用、物理削除しない)
  // SQLite は NOT NULL を外せないためテーブル再作成方式(migrate() が FK を無効にして実行する)
  `
  create table trips_new (
    id text primary key,
    title text not null,
    started_at text,
    ended_at text,
    transport text,
    deleted_at text,
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  insert into trips_new (id, title, started_at, ended_at, created_at, updated_at)
    select id, title, started_at, ended_at, created_at, updated_at from trips;
  drop table trips;
  alter table trips_new rename to trips;
  create index trips_started_idx on trips (started_at desc);
  `,
  // プラン機能のデータモデル。プラン系(trips / trip_days / checkpoints)は iOS と
  // 双方向同期するため、updated_at はクライアントの編集時刻(LWW の基準)、
  // deleted_at は tombstone(物理削除しない)
  `
  create table trip_days (
    id text primary key,
    trip_id text not null references trips (id) on delete cascade,
    date text not null,
    title text,
    note text,
    updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    deleted_at text,
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  create index trip_days_trip_date_idx on trip_days (trip_id, date);

  create table checkpoints (
    id text primary key,
    trip_id text not null references trips (id) on delete cascade,
    trip_day_id text not null references trip_days (id) on delete cascade,
    type text not null check (type in
      ('departure', 'destination', 'sightseeing', 'cafe', 'restaurant', 'lodging', 'other')),
    name text not null,
    latitude real,
    longitude real,
    planned_time text,
    note text,
    sort_order integer not null default 0,
    updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    deleted_at text,
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  create index checkpoints_day_order_idx on checkpoints (trip_day_id, sort_order);
  `,
  // サーバ側のみの設定(同期対象外)。AI モデル選択などを key-value で保持する。
  // AI 呼び出しはすべてサーバ側なので iOS に配る必要がない
  `
  create table app_settings (
    key text primary key,
    value text not null,
    updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  `,
  // 旅行作成フローの変更: 出発予定日時(departure_at。実績の started_at とは別)と
  // 目的地(destination。AI の日数・宿泊地候補出しの入力)を trips に追加
  `
  alter table trips add column departure_at text;
  alter table trips add column destination text;
  `,
  // AI 生成の非同期ジョブ(サーバ専用・同期対象外)。生成に数分かかるため、
  // iOS は接続を張りっぱなしにせずジョブ登録 → ポーリングで結果を受け取る。
  // result は提案 JSON の置き場で、採用するまで trip_days / checkpoints には書かない
  `
  create table ai_jobs (
    id text primary key,
    kind text not null check (kind in ('plan', 'trip_outline')),
    status text not null check (status in ('pending', 'running', 'succeeded', 'failed')),
    input text not null,
    result text,
    error text,
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  `,
  // 道路ルートのレグ(隣接チェックポイント間)キャッシュ(サーバ専用・同期対象外)。
  // key は座標ペアを小数 4 桁(約 10m)で丸めた "lat,lon>lat,lon"。座標が変われば
  // キーが変わるので明示的な無効化は不要。geometry は GeoJSON LineString の
  // 座標列 [[lon,lat],...] の JSON
  `
  create table route_legs (
    key text primary key,
    geometry text not null,
    distance_m real not null,
    duration_s real not null,
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  create index route_legs_created_idx on route_legs (created_at);
  `,
  // 日単位の出発時刻(その日の宿泊地 = 前泊地を出る時刻)。日付は date が持つので
  // 時刻のみ "HH:MM" のローカル時刻文字列(date と同じタイムゾーン素朴表現)。
  // 到着予想時刻は保存せず、クライアントがレグ所要時間から表示時に導出する
  `
  alter table trip_days add column departure_time text;
  `,
  // メディアの削除を iOS と Web の双方向にする。ファイルは物理削除するが、
  // 行は tombstone として残して pull で iOS に「消えた」ことを伝える
  // (media 自体は従来どおり不変・一方向アップロード)
  `
  alter table media add column deleted_at text;
  `,
];

// dev サーバの HMR で接続が増殖しないよう globalThis にキャッシュする
const globalCache = globalThis as unknown as { __tripnoteDb?: Database.Database };

function resolveDbPath(): string {
  return (
    process.env.TRIPNOTE_DB_PATH ??
    path.join(process.cwd(), "data", "trip-note.db")
  );
}

/// メディアファイルの保存先。未設定時は DB と同じディレクトリの media/
/// (本番は /app/data/media になり、既存の volume に含まれる)。
/// path.dirname を静的パスに掛けると Turbopack のファイルトレースが
/// プロジェクト全体を出力に含めてしまうため、既定値は直接書く
export function getMediaDir(): string {
  let dir = process.env.TRIPNOTE_MEDIA_DIR;
  if (!dir) {
    const dbPath = process.env.TRIPNOTE_DB_PATH;
    dir = dbPath
      ? path.join(path.dirname(dbPath), "media")
      : path.join(process.cwd(), "data", "media");
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getDb(): Database.Database {
  if (globalCache.__tripnoteDb) {
    return globalCache.__tripnoteDb;
  }
  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  // FK は migrate の後に有効化する(テーブル再作成マイグレーションの drop table が
  // FK 有効だと暗黙 DELETE になり、on delete cascade で子行を消してしまうため)
  migrate(db);
  db.pragma("foreign_keys = ON");
  globalCache.__tripnoteDb = db;
  return db;
}

function migrate(db: Database.Database) {
  const applied = db.pragma("user_version", { simple: true }) as number;
  if (applied >= MIGRATIONS.length) {
    return;
  }
  db.pragma("foreign_keys = OFF");
  for (let version = applied; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
  const violations = db.pragma("foreign_key_check") as unknown[];
  if (violations.length > 0) {
    throw new Error(
      `migration left ${violations.length} foreign key violation(s)`,
    );
  }
}
