import { describe, expect, it } from "vitest";
import { googleMapsSearchUrl } from "@/lib/google-maps";

describe("googleMapsSearchUrl", () => {
  it("座標がクエリに入る", () => {
    expect(googleMapsSearchUrl(35.681236, 139.767125)).toBe(
      "https://www.google.com/maps/search/?api=1&query=35.681236,139.767125",
    );
  });

  it("負の座標と小数 6 桁への丸め", () => {
    expect(googleMapsSearchUrl(-33.86748456, -151.20699789)).toBe(
      "https://www.google.com/maps/search/?api=1&query=-33.867485,-151.206998",
    );
  });

  it("整数座標も小数 6 桁で出す", () => {
    expect(googleMapsSearchUrl(35, 139)).toBe(
      "https://www.google.com/maps/search/?api=1&query=35.000000,139.000000",
    );
  });
});
