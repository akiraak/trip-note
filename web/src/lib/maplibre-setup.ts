import { setWorkerUrl, type StyleSpecification } from "maplibre-gl";

// 地図コンポーネント共通のセットアップ。**クライアントコンポーネントからのみ** import する
// (読み込み時に副作用として maplibre のワーカー URL を差し替えるため)。

// バンドラ(Turbopack)経由だと maplibre が自身のワーカーを解決できないため、
// public/ に置いたワーカー(npm run copy-maplibre-worker が配置)を明示する
setWorkerUrl("/maplibre-gl-worker.mjs");

// OpenFreeMap のベクタタイル。登録・API キー不要で本番利用可、帰属表記はスタイル側に
// 含まれる。選定経緯は docs/plans/archive/web-map-tiles-production.md
// UI がダーク固定(案 C)なので地図も dark スタイルを使う
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

/// dark スタイルは陸地に塗りが無く、旅行全体のような低ズームでは一面が黒くなる。
/// スタイルに含まれている Natural Earth の陰影(zoom 6 まで)を暗く敷いて、
/// 大陸・海岸線の形が分かるようにする
function withShadedRelief(style: StyleSpecification): StyleSpecification {
  if (style.layers.some((layer) => layer.id === "ne2-shaded")) {
    return style;
  }
  // background(先頭)のすぐ上、water より下に差し込む
  style.layers.splice(1, 0, {
    id: "ne2-shaded",
    type: "raster",
    source: "ne2_shaded",
    maxzoom: 7,
    paint: {
      "raster-opacity": 0.8,
      "raster-brightness-max": 0.62,
      "raster-saturation": -0.35,
    },
  });
  return style;
}

let cached: Promise<StyleSpecification> | null = null;

/// 地図に渡すスタイル。取得と加工は 1 回だけ行う(ページ内に地図が複数あっても取得は 1 回)。
/// maplibre は渡されたスタイルオブジェクトを内部で書き換えるので、
/// 地図ごとにコピーを渡す(同じオブジェクトを使い回すと 2 つ目以降が読み込めない)
export function mapStyle(): Promise<StyleSpecification> {
  cached ??= fetch(MAP_STYLE_URL)
    .then((response) => response.json() as Promise<StyleSpecification>)
    .then(withShadedRelief)
    .catch((error: unknown) => {
      cached = null;
      throw error;
    });
  return cached.then((style) => structuredClone(style));
}
