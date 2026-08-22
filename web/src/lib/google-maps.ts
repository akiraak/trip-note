// Google Maps へ座標を渡す URL の生成(公式のクロスプラットフォーム形式 Maps URLs)。
// 名前で検索すると同名の別地点に飛び得るため、クエリは座標のみにする

export function googleMapsSearchUrl(
  latitude: number,
  longitude: number,
): string {
  // 小数 6 桁(約 0.1 m)あれば十分
  return `https://www.google.com/maps/search/?api=1&query=${latitude.toFixed(6)},${longitude.toFixed(6)}`;
}
