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
  it("viewbox があれば bounded なしで付け、無ければ付けない", async () => {
    const fetchMock = vi.fn<(input: URL) => Promise<unknown>>(async () =>
      nominatimOk(),
    );
    vi.stubGlobal("fetch", fetchMock);

    await searchPlaces("カフェ", [137.8, 36.1, 138.1, 36.3]);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("viewbox")).toBe("137.8,36.1,138.1,36.3");
    expect(url.searchParams.get("bounded")).toBeNull();

    await searchPlaces("カフェ");
    const plain = new URL(String(fetchMock.mock.calls[1][0]));
    expect(plain.searchParams.get("viewbox")).toBeNull();
  });

  it("同じクエリでも viewbox が違えば別キャッシュ、同じなら再送しない", async () => {
    const fetchMock = vi.fn<(input: URL) => Promise<unknown>>(async () =>
      nominatimOk(),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await searchPlaces("カフェ", [137.8, 36.1, 138.1, 36.3]);
    expect(first[0]).toMatchObject({ name: "珈琲まるも", guessedType: "cafe" });
    await searchPlaces("カフェ", [137.8, 36.1, 138.1, 36.3]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await searchPlaces("カフェ", [137.0, 36.1, 137.3, 36.3]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
