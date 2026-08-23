import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractGoogleMapsUrl,
  isGoogleMapsUrl,
  parseGoogleMapsUrl,
  parseLinkInput,
  resolveGoogleMapsLink,
} from "@/lib/google-maps-share";

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
    const place = await resolveGoogleMapsLink(`松本城\n${SHORT_URL}`, fetchMock as typeof fetch);
    expect(place).toEqual({
      name: "松本城",
      latitude: 36.238653,
      longitude: 137.9688674,
      precision: "pin",
      resolvedUrl: PLACE_URL,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [firstUrl, firstInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(firstUrl).toBe(SHORT_URL);
    expect(firstInit.redirect).toBe("manual");
    expect((firstInit.headers as Record<string, string>)["User-Agent"]).toContain("trip-note");

    const again = await resolveGoogleMapsLink(SHORT_URL, fetchMock as typeof fetch);
    expect(again).toEqual(place);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("座標入りの長い URL は取得せずに返す", async () => {
    const fetchMock = vi.fn();
    const place = await resolveGoogleMapsLink(PLACE_URL, fetchMock as typeof fetch);
    expect(place.name).toBe("松本城");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("展開後の URL に座標が無ければ名前だけ返す(本文の既定の地図中心は使わない)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirect("https://www.google.com/maps/place/%E6%9D%BE%E6%9C%AC%E5%9F%8E"))
      .mockResolvedValueOnce(okHtml());
    const place = await resolveGoogleMapsLink(SHORT_URL, fetchMock as typeof fetch);
    expect(place).toEqual({
      name: "松本城",
      latitude: null,
      longitude: null,
      precision: null,
      resolvedUrl: "https://www.google.com/maps/place/%E6%9D%BE%E6%9C%AC%E5%9F%8E",
    });
  });

  it("名前も座標も取れなければ失敗する", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirect("https://www.google.com/maps/"))
      .mockResolvedValueOnce(okHtml());
    await expect(resolveGoogleMapsLink(SHORT_URL, fetchMock as typeof fetch)).rejects.toThrow(
      "場所を特定できませんでした",
    );
  });

  it("許可外ホストへの転送・転送過多・エラー応答は失敗する", async () => {
    const toEvil = vi.fn().mockResolvedValueOnce(redirect("https://evil.example/x"));
    await expect(resolveGoogleMapsLink(SHORT_URL, toEvil as typeof fetch)).rejects.toThrow(
      "Google Maps ではない",
    );
    const toHttp = vi.fn().mockResolvedValueOnce(redirect("http://www.google.com/maps/place/x"));
    await expect(
      resolveGoogleMapsLink("https://goo.gl/maps/x1", toHttp as typeof fetch),
    ).rejects.toThrow("Google Maps ではない");

    const loop = vi.fn(async () => redirect("/maps/loop"));
    await expect(
      resolveGoogleMapsLink("https://maps.app.goo.gl/loop", loop as typeof fetch),
    ).rejects.toThrow("転送が多すぎます");

    const notFound = vi.fn(async () => new Response("", { status: 404 }));
    await expect(
      resolveGoogleMapsLink("https://maps.app.goo.gl/nf", notFound as typeof fetch),
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
    );
    expect(place.resolvedUrl).toBe("https://www.google.com/maps/place/x/@36.2,137.9,15z");
    expect(place).toMatchObject({ latitude: 36.2, precision: "center" });
  });

  it("Google Maps のリンクが無い入力は失敗する", async () => {
    await expect(resolveGoogleMapsLink("松本城", vi.fn() as typeof fetch)).rejects.toThrow(
      "リンクが見つかりません",
    );
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
