import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractGoogleMapsUrl,
  geocodeCandidates,
  isGoogleMapsUrl,
  parseGoogleMapsUrl,
  parseLinkInput,
  parseQueryText,
  resolveGoogleMapsLink,
  shareNameHint,
} from "@/lib/google-maps-share";

// ジオコーダ(Nominatim)は呼ばずにモックする。既定は「何も当たらない」
const noHit = vi.fn(async () => []);

afterEach(() => {
  (
    globalThis as unknown as { __tripnoteGoogleMapsShare?: unknown }
  ).__tripnoteGoogleMapsShare = undefined;
  vi.unstubAllGlobals();
});

// 2026-08-23 にブラウザ版 Google Maps の松本城の場所ページで採取した実物
const PLACE_URL =
  "https://www.google.com/maps/place/%E6%9D%BE%E6%9C%AC%E5%9F%8E/@36.238653,137.9688674,17z/data=!3m1!4b1!4m6!3m5!1s0x601d0e850a9a5999:0x902d0e20fabcf654!8m2!3d36.238653!4d137.9688674!16zL20vMDM5cXE2?hl=ja&entry=ttu&g_ep=EgoyMDI2MDgxOS4wIKXMDSoASAFQAw%3D%3D";
const SHORT_URL = "https://maps.app.goo.gl/AbCdEfGh12345678";

describe("extractGoogleMapsUrl", () => {
  it("共有テキスト(名前 + 短縮リンク)からリンクを取り出す", () => {
    expect(extractGoogleMapsUrl(`松本城\n${SHORT_URL}`)).toBe(SHORT_URL);
    expect(extractGoogleMapsUrl(SHORT_URL)).toBe(SHORT_URL);
    expect(extractGoogleMapsUrl(`  ${PLACE_URL}  `)).toBe(PLACE_URL);
  });

  it("文末の句読点・括弧を落とし、Google Maps 以外の URL は無視する", () => {
    expect(extractGoogleMapsUrl(`ここ(${SHORT_URL})。`)).toBe(SHORT_URL);
    expect(extractGoogleMapsUrl(`${SHORT_URL}、見て`)).toBe(SHORT_URL);
    expect(extractGoogleMapsUrl("https://example.com/maps/place/x")).toBeNull();
    expect(extractGoogleMapsUrl("松本城")).toBeNull();
    expect(extractGoogleMapsUrl("")).toBeNull();
    // 先に別サイトの URL があっても Google Maps のものを選ぶ
    expect(extractGoogleMapsUrl(`https://example.com ${SHORT_URL}`)).toBe(SHORT_URL);
  });

  it("isGoogleMapsUrl はホストの許可リストで判定する", () => {
    expect(isGoogleMapsUrl(SHORT_URL)).toBe(true);
    expect(isGoogleMapsUrl("https://maps.google.co.jp/?q=1,2")).toBe(true);
    expect(isGoogleMapsUrl("https://evil.google.com.example/")).toBe(false);
    expect(isGoogleMapsUrl("ftp://www.google.com/maps")).toBe(false);
    expect(isGoogleMapsUrl("not a url")).toBe(false);
  });
});

describe("parseGoogleMapsUrl", () => {
  it("場所ページの URL から名前とピンの座標を取る", () => {
    expect(parseGoogleMapsUrl(PLACE_URL)).toEqual({
      name: "松本城",
      latitude: 36.238653,
      longitude: 137.9688674,
      precision: "pin",
    });
  });

  it("英語名の + は空白に戻す", () => {
    expect(
      parseGoogleMapsUrl(
        "https://www.google.com/maps/place/Matsumoto+Castle/@36.2386,137.9688,17z/data=!4m2!3m1!1s0x0:0x0",
      ),
    ).toEqual({
      name: "Matsumoto Castle",
      latitude: 36.2386,
      longitude: 137.9688,
      precision: "center",
    });
  });

  it("!3d!4d が無ければ @ の表示中心を使う(precision は center)", () => {
    expect(
      parseGoogleMapsUrl(
        "https://www.google.com/maps/place/%E4%B8%8A%E9%AB%98%E5%9C%B0/@36.2495,137.6354,15z",
      ),
    ).toEqual({
      name: "上高地",
      latitude: 36.2495,
      longitude: 137.6354,
      precision: "center",
    });
  });

  it("q / query の座標(ドロップピン・Maps URLs)を読む", () => {
    expect(parseGoogleMapsUrl("https://maps.google.com/?q=36.2387,137.9689")).toEqual({
      name: null,
      latitude: 36.2387,
      longitude: 137.9689,
      precision: "pin",
    });
    expect(
      parseGoogleMapsUrl(
        "https://www.google.com/maps/search/?api=1&query=36.238653%2C137.968867",
      ),
    ).toEqual({
      name: null,
      latitude: 36.238653,
      longitude: 137.968867,
      precision: "pin",
    });
    // "lat,lng (ラベル)" 形式はラベルを名前にする
    expect(
      parseGoogleMapsUrl(
        "https://maps.google.com/?q=36.2387,137.9689+(%E6%9D%BE%E6%9C%AC%E5%9F%8E)",
      ),
    ).toEqual({
      name: "松本城",
      latitude: 36.2387,
      longitude: 137.9689,
      precision: "pin",
    });
  });

  it("座標が無く名前だけのリンクは名前のみ返す", () => {
    expect(
      parseGoogleMapsUrl("https://www.google.com/maps/place/%E6%9D%BE%E6%9C%AC%E5%9F%8E"),
    ).toEqual({ name: "松本城", latitude: null, longitude: null, precision: null });
    expect(parseGoogleMapsUrl("https://maps.google.com/?q=%E6%9D%BE%E6%9C%AC%E5%9F%8E")).toEqual({
      name: "松本城",
      latitude: null,
      longitude: null,
      precision: null,
    });
    expect(
      parseGoogleMapsUrl("https://www.google.com/maps/search/%E6%9D%BE%E6%9C%AC%E5%9F%8E/"),
    ).toMatchObject({ name: "松本城", latitude: null });
  });

  it("パスが座標そのもののときは名前にしない", () => {
    expect(
      parseGoogleMapsUrl("https://www.google.com/maps/place/36.2387,137.9689/@36.2387,137.9689,17z"),
    ).toEqual({ name: null, latitude: 36.2387, longitude: 137.9689, precision: "center" });
  });

  it("短縮リンク自体からは何も取れない(展開が必要)", () => {
    expect(parseGoogleMapsUrl(SHORT_URL)).toEqual({
      name: null,
      latitude: null,
      longitude: null,
      precision: null,
    });
  });

  it("Dynamic Links 形式(?link=)は中の URL を見る", () => {
    const wrapped = `https://maps.app.goo.gl/?link=${encodeURIComponent(PLACE_URL)}&apn=com.google.android.apps.maps`;
    expect(parseGoogleMapsUrl(wrapped)).toMatchObject({ name: "松本城", precision: "pin" });
  });

  it("経路のリンク・Google Maps 以外は例外", () => {
    expect(() =>
      parseGoogleMapsUrl("https://www.google.com/maps/dir/%E6%9D%BE%E6%9C%AC/%E4%B8%8A%E9%AB%98%E5%9C%B0/"),
    ).toThrow("経路のリンク");
    expect(() => parseGoogleMapsUrl("https://example.com/maps/place/x")).toThrow(
      "Google Maps のリンクではありません",
    );
  });

  it("範囲外の座標・0,0 は無視する", () => {
    expect(parseGoogleMapsUrl("https://maps.google.com/?q=999,137")).toMatchObject({
      latitude: null,
      name: "999,137",
    });
    expect(
      parseGoogleMapsUrl("https://www.google.com/maps/place/x/@0,0,2z/data=!3d0!4d0"),
    ).toMatchObject({ name: "x", latitude: null, precision: null });
  });
});

// iOS アプリの共有(g_st=ig)の展開先。実物(2026-08-23)。座標は無く q に「名前, 住所」
const APP_SHARE_URL =
  "https://www.google.com/maps?q=Hotel+Ruby+%7C+Spokane,+901+W+1st+Ave+Ste.+B,+Spokane,+WA+99201&ftid=0x549e1866de33ec49:0x963bd390f6ecd017&entry=gps&g_st=ig";
const APP_SHARE_URL_JP =
  "https://www.google.com/maps?q=%E6%97%A5%E6%9C%AC%E3%80%81%E3%80%92390-0873+%E9%95%B7%E9%87%8E%E7%9C%8C%E6%9D%BE%E6%9C%AC%E5%B8%82%E4%B8%B8%E3%81%AE%E5%86%85%EF%BC%94%E2%88%92%EF%BC%91+%E6%9D%BE%E6%9C%AC%E5%9F%8E&ftid=0x601d0e850a9a5999:0x902d0e20fabcf654&entry=gps";

describe("shareNameHint / parseQueryText / geocodeCandidates", () => {
  it("共有テキストの名前は URL を除いた最初の行", () => {
    expect(shareNameHint(`Hotel Ruby | Spokane ${SHORT_URL}`)).toBe("Hotel Ruby | Spokane");
    expect(shareNameHint(`松本城\n${SHORT_URL}`)).toBe("松本城");
    expect(shareNameHint(`\n\n${SHORT_URL}\n上高地`)).toBe("上高地");
    expect(shareNameHint(SHORT_URL)).toBeNull();
  });

  it("欧米形式の q は先頭が名前、末尾の手前が市名", () => {
    expect(
      parseQueryText("Hotel Ruby | Spokane, 901 W 1st Ave Ste. B, Spokane, WA 99201"),
    ).toEqual({
      name: "Hotel Ruby | Spokane",
      locality: "Spokane",
      townAddress: null,
      full: "Hotel Ruby | Spokane, 901 W 1st Ave Ste. B, Spokane, WA 99201",
    });
  });

  it("日本形式の q は 〒 の次が住所、その後ろが名前。市区町村と町丁目を切り出す", () => {
    expect(parseQueryText("日本、〒390-0873 長野県松本市丸の内４−１ 松本城")).toEqual({
      name: "松本城",
      locality: "松本市",
      townAddress: "長野県松本市丸の内",
      full: "日本、〒390-0873 長野県松本市丸の内４−１ 松本城",
    });
    expect(
      parseQueryText("〒142-0062 東京都品川区小山３丁目７−１２ サンハイツ 102 Gelateria Italiana Ciao"),
    ).toMatchObject({
      name: "サンハイツ 102 Gelateria Italiana Ciao",
      locality: "品川区",
      townAddress: "東京都品川区小山３丁目",
    });
    expect(parseQueryText("〒600-8216 京都府京都市下京区東塩小路町 京都駅")).toMatchObject({
      name: "京都駅",
      locality: "京都市",
      townAddress: "京都府京都市下京区東塩小路町",
    });
    expect(parseQueryText("〒904-0117 沖縄県中頭郡北谷町北前１−２ 店")).toMatchObject({
      locality: "中頭郡北谷町",
      townAddress: "沖縄県中頭郡北谷町北前",
    });
  });

  it("候補: 日本形式は「名前 市区町村」→ 名前 → 町丁目(area)、欧米形式は全文 → 名前, 市 → 名前", () => {
    expect(
      geocodeCandidates(parseQueryText("日本、〒390-0873 長野県松本市丸の内４−１ 松本城"), "松本城"),
    ).toEqual({ exact: ["松本城 松本市", "松本城"], area: ["長野県松本市丸の内"] });
    // 共有テキストの名前(ヒント)があれば q から切り出した名前より優先
    expect(
      geocodeCandidates(
        parseQueryText("〒142-0062 東京都品川区小山３丁目７−１２ サンハイツ 102 Gelateria Italiana Ciao"),
        "Gelateria Italiana Ciao",
      ),
    ).toEqual({
      exact: ["Gelateria Italiana Ciao 品川区", "Gelateria Italiana Ciao"],
      area: ["東京都品川区小山３丁目"],
    });
    expect(
      geocodeCandidates(
        parseQueryText("Hotel Ruby | Spokane, 901 W 1st Ave Ste. B, Spokane, WA 99201"),
        null,
      ),
    ).toEqual({
      exact: [
        "Hotel Ruby | Spokane, 901 W 1st Ave Ste. B, Spokane, WA 99201",
        "Hotel Ruby | Spokane, Spokane",
        "Hotel Ruby | Spokane",
      ],
      area: [],
    });
    // 名前だけ(住所なし)は重複を除いて 1 候補
    expect(geocodeCandidates(parseQueryText("松本城"), null)).toEqual({
      exact: ["松本城"],
      area: [],
    });
  });
});

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

// 名前だけの場所ページの本文。og:image の center は接続元 IP から推定した既定の地図中心
// (シアトル)で場所とは無関係なので、ここから座標を拾ってはいけない
const SEATTLE_HTML =
  '<html><head><meta property="og:image" content="https://maps.google.com/maps/api/staticmap?center=47.6833578%2C-122.3601416&zoom=14"></head></html>';

function okHtml(html = SEATTLE_HTML): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

describe("resolveGoogleMapsLink", () => {
  it("短縮リンクを展開して場所を返し、2 回目はキャッシュで fetch しない", async () => {
    const fetchMock = vi.fn(async () => redirect(PLACE_URL));
    // 展開先は長い URL なので 1 ホップで座標が取れる(本文は不要)
    fetchMock.mockResolvedValueOnce(redirect(PLACE_URL)).mockResolvedValueOnce(okHtml());
    const place = await resolveGoogleMapsLink(
      `松本城\n${SHORT_URL}`,
      fetchMock as typeof fetch,
      noHit,
    );
    expect(place).toEqual({
      name: "松本城",
      latitude: 36.238653,
      longitude: 137.9688674,
      precision: "pin",
      resolvedUrl: PLACE_URL,
      geocodedQuery: null,
    });
    expect(noHit).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [firstUrl, firstInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(firstUrl).toBe(SHORT_URL);
    expect(firstInit.redirect).toBe("manual");
    expect((firstInit.headers as Record<string, string>)["User-Agent"]).toContain("trip-note");

    const again = await resolveGoogleMapsLink(`松本城\n${SHORT_URL}`, fetchMock as typeof fetch, noHit);
    expect(again).toEqual(place);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("座標入りの長い URL は取得せずに返す", async () => {
    const fetchMock = vi.fn();
    const place = await resolveGoogleMapsLink(PLACE_URL, fetchMock as typeof fetch, noHit);
    expect(place.name).toBe("松本城");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("iOS アプリの共有(q に名前 + 住所、座標なし)は Nominatim で引いて geocoded にする", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(redirect(APP_SHARE_URL)).mockResolvedValueOnce(okHtml());
    const geocoder = vi.fn(async (query: string) =>
      query.startsWith("Hotel Ruby | Spokane, 901") ? [{ latitude: 47.6562163, longitude: -117.4252411 }] : [],
    );
    const place = await resolveGoogleMapsLink(
      `Hotel Ruby | Spokane ${SHORT_URL}`,
      fetchMock as typeof fetch,
      geocoder,
    );
    expect(place).toEqual({
      name: "Hotel Ruby | Spokane",
      latitude: 47.6562163,
      longitude: -117.4252411,
      precision: "geocoded",
      resolvedUrl: APP_SHARE_URL,
      geocodedQuery: "Hotel Ruby | Spokane, 901 W 1st Ave Ste. B, Spokane, WA 99201",
    });
    expect(geocoder).toHaveBeenCalledTimes(1);
  });

  it("日本の住所は「名前 市区町村」で当て、名前は共有テキストのもの", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(redirect(APP_SHARE_URL_JP)).mockResolvedValueOnce(okHtml());
    const geocoder = vi.fn(async (query: string) =>
      query === "松本城 松本市" ? [{ latitude: 36.2386353, longitude: 137.9688709 }] : [],
    );
    const place = await resolveGoogleMapsLink(`松本城\n${SHORT_URL}`, fetchMock as typeof fetch, geocoder);
    expect(place).toMatchObject({
      name: "松本城",
      latitude: 36.2386353,
      precision: "geocoded",
      geocodedQuery: "松本城 松本市",
    });
    expect(geocoder).toHaveBeenCalledTimes(1);
  });

  it("名前で当たらなければ町丁目で引いて area、それも無ければ名前だけ返す", async () => {
    const fetchMock = vi.fn(async () => redirect(APP_SHARE_URL_JP));
    fetchMock.mockResolvedValueOnce(redirect(APP_SHARE_URL_JP)).mockResolvedValueOnce(okHtml());
    const areaOnly = vi.fn(async (query: string) =>
      query === "長野県松本市丸の内" ? [{ latitude: 36.23835, longitude: 137.9699 }] : [],
    );
    const place = await resolveGoogleMapsLink(SHORT_URL, fetchMock as typeof fetch, areaOnly);
    expect(place).toMatchObject({
      name: "松本城",
      latitude: 36.23835,
      precision: "area",
      geocodedQuery: "長野県松本市丸の内",
    });
    // 名前 市 → 名前 → 町丁目 の 3 回
    expect(areaOnly).toHaveBeenCalledTimes(3);

    fetchMock.mockResolvedValueOnce(redirect(APP_SHARE_URL_JP)).mockResolvedValueOnce(okHtml());
    const none = await resolveGoogleMapsLink(
      `上高地\n${SHORT_URL}`,  // 名前が違えばキャッシュキーも別
      fetchMock as typeof fetch,
      noHit,
    );
    expect(none).toMatchObject({ name: "上高地", latitude: null, precision: null, geocodedQuery: null });
  });

  it("展開後の URL に座標が無く、名前だけのときも本文の既定の地図中心は使わない", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirect("https://www.google.com/maps/place/%E6%9D%BE%E6%9C%AC%E5%9F%8E"))
      .mockResolvedValueOnce(okHtml());
    const place = await resolveGoogleMapsLink(SHORT_URL, fetchMock as typeof fetch, noHit);
    expect(place).toEqual({
      name: "松本城",
      latitude: null,
      longitude: null,
      precision: null,
      resolvedUrl: "https://www.google.com/maps/place/%E6%9D%BE%E6%9C%AC%E5%9F%8E",
      geocodedQuery: null,
    });
    expect(noHit).toHaveBeenCalledWith("松本城");
  });

  it("名前も座標も取れなければ失敗する", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirect("https://www.google.com/maps/"))
      .mockResolvedValueOnce(okHtml());
    await expect(
      resolveGoogleMapsLink(SHORT_URL, fetchMock as typeof fetch, noHit),
    ).rejects.toThrow("場所を特定できませんでした");
  });

  it("許可外ホストへの転送・転送過多・エラー応答は失敗する", async () => {
    const toEvil = vi.fn().mockResolvedValueOnce(redirect("https://evil.example/x"));
    await expect(resolveGoogleMapsLink(SHORT_URL, toEvil as typeof fetch, noHit)).rejects.toThrow(
      "Google Maps ではない",
    );
    const toHttp = vi.fn().mockResolvedValueOnce(redirect("http://www.google.com/maps/place/x"));
    await expect(
      resolveGoogleMapsLink("https://goo.gl/maps/x1", toHttp as typeof fetch, noHit),
    ).rejects.toThrow("Google Maps ではない");

    const loop = vi.fn(async () => redirect("/maps/loop"));
    await expect(
      resolveGoogleMapsLink("https://maps.app.goo.gl/loop", loop as typeof fetch, noHit),
    ).rejects.toThrow("転送が多すぎます");

    const notFound = vi.fn(async () => new Response("", { status: 404 }));
    await expect(
      resolveGoogleMapsLink("https://maps.app.goo.gl/nf", notFound as typeof fetch, noHit),
    ).rejects.toThrow("(404)");
  });

  it("相対 Location は元 URL 基準で解決する", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirect("/maps/place/x/@36.2,137.9,15z"))
      .mockResolvedValueOnce(okHtml());
    const place = await resolveGoogleMapsLink(
      "https://www.google.com/maps?cid=123",
      fetchMock as typeof fetch,
      noHit,
    );
    expect(place.resolvedUrl).toBe("https://www.google.com/maps/place/x/@36.2,137.9,15z");
    expect(place).toMatchObject({ latitude: 36.2, precision: "center" });
  });

  it("Google Maps のリンクが無い入力は失敗する", async () => {
    await expect(
      resolveGoogleMapsLink("松本城", vi.fn() as typeof fetch, noHit),
    ).rejects.toThrow("リンクが見つかりません");
  });
});

describe("parseLinkInput", () => {
  it("空・非文字列・長すぎる入力を弾く", () => {
    expect(parseLinkInput(` ${SHORT_URL} `)).toBe(SHORT_URL);
    expect(() => parseLinkInput("")).toThrow();
    expect(() => parseLinkInput(undefined)).toThrow();
    expect(() => parseLinkInput(123)).toThrow();
    expect(() => parseLinkInput("x".repeat(4001))).toThrow("長すぎます");
  });
});
