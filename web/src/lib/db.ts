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
  db.pragma("foreign_keys = ON");
  migrate(db);
  globalCache.__tripnoteDb = db;
  return db;
}

function migrate(db: Database.Database) {
  const applied = db.pragma("user_version", { simple: true }) as number;
  for (let version = applied; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}
