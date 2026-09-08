import { describe, expect, it } from "vitest";
import { isShareMethodAllowed, isSharePath } from "@/lib/share-guard";

// /share/* の公開経路は閲覧(GET / HEAD)だけを通す(src/proxy.ts が使う判定)。
// Server Action の POST を Cloudflare Access の Bypass 経路から叩かせないための境界

describe("isShareMethodAllowed", () => {
  it("GET / HEAD だけ通す(大文字小文字は問わない)", () => {
    expect(isShareMethodAllowed("GET")).toBe(true);
    expect(isShareMethodAllowed("head")).toBe(true);
    expect(isShareMethodAllowed("POST")).toBe(false);
    expect(isShareMethodAllowed("PUT")).toBe(false);
    expect(isShareMethodAllowed("DELETE")).toBe(false);
    expect(isShareMethodAllowed("OPTIONS")).toBe(false);
  });
});

describe("isSharePath", () => {
  it("/share と /share/… だけ(似た名前の別パスは含めない)", () => {
    expect(isSharePath("/share")).toBe(true);
    expect(isSharePath("/share/")).toBe(true);
    expect(isSharePath("/share/abc/media/x")).toBe(true);
    expect(isSharePath("/shared")).toBe(false);
    expect(isSharePath("/trips/share")).toBe(false);
    expect(isSharePath("/")).toBe(false);
  });
});
