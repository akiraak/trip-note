import { afterEach, describe, expect, it, vi } from "vitest";
import { searchPlaces } from "@/lib/nominatim";

// 実 Nominatim は呼ばず global fetch をモックする(routing と同方針)

afterEach(() => {
  (globalThis as unknown as { __tripnoteNominatim?: unknown }).__tripnoteNominatim =
    undefined;
  vi.unstubAllGlobals();
});

function nominatimOk() {
  return {
    ok: true,
    json: async () => [
      {
        name: "珈琲まるも",
        display_name: "珈琲まるも, 松本市, 長野県",
        lat: "36.2328",
        lon: "137.9689",
        category: "amenity",
        type: "cafe",
      },
    ],
  };
}

describe("searchPlaces", () => {
  it("クエリを座標に変換する(範囲指定なし)", async () => {
    const fetchMock = vi.fn<(input: URL) => Promise<unknown>>(async () =>
      nominatimOk(),
    );
    vi.stubGlobal("fetch", fetchMock);

    const places = await searchPlaces("珈琲まるも 松本市");
    expect(places[0]).toEqual({ latitude: 36.2328, longitude: 137.9689 });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("q")).toBe("珈琲まるも 松本市");
    expect(url.searchParams.get("viewbox")).toBeNull();
    expect(url.searchParams.get("bounded")).toBeNull();
  });

  it("同じクエリは再送せず、違うクエリは別キャッシュ", async () => {
    const fetchMock = vi.fn<(input: URL) => Promise<unknown>>(async () =>
      nominatimOk(),
    );
    vi.stubGlobal("fetch", fetchMock);

    await searchPlaces("松本城");
    await searchPlaces("松本城");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await searchPlaces("松本市丸の内");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
