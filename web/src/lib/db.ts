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
