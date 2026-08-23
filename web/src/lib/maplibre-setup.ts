import { setWorkerUrl } from "maplibre-gl";

// 地図コンポーネント共通のセットアップ。**クライアントコンポーネントからのみ** import する
// (読み込み時に副作用として maplibre のワーカー URL を差し替えるため)。

// バンドラ(Turbopack)経由だと maplibre が自身のワーカーを解決できないため、
// public/ に置いたワーカー(npm run copy-maplibre-worker が配置)を明示する
setWorkerUrl("/maplibre-gl-worker.mjs");

// OpenFreeMap のベクタタイル。登録・API キー不要で本番利用可、帰属表記はスタイル側に
// 含まれる。選定経緯は docs/plans/archive/web-map-tiles-production.md
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
