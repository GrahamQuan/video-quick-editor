import { expect, it, vi } from "vitest";
import { AppUpdates, compareVersions, newestRelease } from "./app-updates.js";

function release(version: string, extra = {}) {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: version.includes("-"),
    assets: [{ name: `Video-Quick-Editor-${version}-mac-arm64.dmg`, state: "uploaded", size: 123 }],
    ...extra,
  };
}
it("compares semantic versions, including numeric prereleases and stable promotion", () => {
  expect(compareVersions("0.1.0-main.10", "0.1.0-main.9")).toBe(1);
  expect(compareVersions("0.1.0", "0.1.0-main.10")).toBe(1);
  expect(compareVersions("0.2.0-main.1", "0.1.0")).toBe(1);
  expect(compareVersions("1.0.0+build.2", "1.0.0+build.1")).toBe(0);
  expect(compareVersions("1.0.0-beta.1", "1.0.0-beta")).toBe(1);
  expect(() => compareVersions("garbage", "1.0.0")).toThrow();
});
it("filters drafts, incomplete/wrong architecture assets and untrusted tags, independent of date order", () => {
  const releases = [
    release("0.2.0-main.10"),
    release("0.2.0-main.9"),
    release("0.1.0"),
    release("9.0.0", { draft: true }),
    release("8.0.0", { assets: [] }),
    release("7.0.0", {
      assets: [{ name: "Video-Quick-Editor-7.0.0-mac-x64.dmg", size: 1, state: "uploaded" }],
    }),
    release("6.0.0", {
      assets: [{ name: "Video-Quick-Editor-6.0.0-mac-arm64.dmg", size: 1, state: "new" }],
    }),
    release("../../other", { html_url: "https://evil.invalid" }),
  ];
  expect(newestRelease(releases, false)?.version).toBe("0.1.0");
  expect(newestRelease(releases, true)).toEqual({
    version: "0.2.0-main.10",
    url: "https://github.com/GrahamQuan/video-quick-editor/releases/tag/v0.2.0-main.10",
  });
});
it("coalesces concurrent checks, uses authoritative URLs and clears stale updates on failure", async () => {
  let finish!: (response: Response) => void;
  const request = vi.fn<typeof fetch>().mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const updates = new AppUpdates("0.1.0-main.9", () => {}, request);
  expect(updates.snapshot().includePrereleases).toBe(true);
  const first = updates.check(true),
    second = updates.check(true);
  expect(first).toBe(second);
  expect(updates.snapshot().status).toBe("checking");
  finish(Response.json([release("0.1.0-main.10")]));
  expect((await first).status).toBe("available");
  const open = vi.fn(async (_url: string) => {});
  await updates.open(open);
  expect(open).toHaveBeenCalledWith(
    "https://github.com/GrahamQuan/video-quick-editor/releases/tag/v0.1.0-main.10",
  );
  request.mockResolvedValue(new Response("", { status: 403 }));
  expect((await updates.check(true)).error).toBe("rate-limit");
  await expect(updates.open(open)).rejects.toThrow();
  request.mockResolvedValue(Response.json([release("0.1.0-main.8")]));
  expect((await updates.check(true)).status).toBe("current");
  request.mockResolvedValue(Response.json({ bad: true }));
  expect((await updates.check(true)).error).toBe("invalid-response");
  request.mockRejectedValue(new Error("secret provider detail"));
  expect((await updates.check(true)).error).toBe("network");
});
it("reads subsequent pages and refuses to report current if the listing is incomplete", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      Response.json(
        typeof url === "string" && url.endsWith("page=1")
          ? Array.from({ length: 100 }, () => release("0.1.0"))
          : [release("0.2.0")],
      ),
    );
  const updates = new AppUpdates("0.1.0", () => {}, request);
  expect(updates.snapshot().includePrereleases).toBe(false);
  expect((await updates.check(false)).latestVersion).toBe("0.2.0");
  expect(request).toHaveBeenCalledTimes(2);
  request.mockImplementation(async () =>
    Response.json(Array.from({ length: 100 }, () => release("0.1.0"))),
  );
  expect((await updates.check(false)).error).toBe("invalid-response");
});
it("handles main builds published after a stable release with the same base version", async () => {
  const stable = release("0.1.0", { published_at: "2026-09-01T00:00:00Z" });
  const main = release("0.1.0-main.8", { published_at: "2026-09-09T00:00:00Z" });
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json([stable, main]));
  const updates = new AppUpdates("0.1.0-main.8", () => {}, request);
  expect((await updates.check(true)).status).toBe("current");
  expect((await updates.check(false)).status).toBe("current");
  const stableInstall = new AppUpdates("0.1.0", () => {}, request);
  expect((await stableInstall.check(true)).latestVersion).toBe("0.1.0-main.8");
  expect(stableInstall.snapshot().status).toBe("available");
  request.mockImplementation(async () =>
    Response.json([main, { ...stable, published_at: "2026-09-10T00:00:00Z" }]),
  );
  expect((await updates.check(true)).latestVersion).toBe("0.1.0");
  expect(updates.snapshot().status).toBe("available");
});
it("does not let a delayed older main run change the stable/main comparison", () => {
  const releases = [
    release("0.1.0-main.10", { published_at: "2026-09-09T00:00:00Z" }),
    release("0.1.0", { published_at: "2026-09-10T00:00:00Z" }),
    release("0.1.0-main.9", { published_at: "2026-09-11T00:00:00Z" }),
  ];
  expect(newestRelease(releases, true)?.version).toBe("0.1.0");
  expect(newestRelease([...releases].reverse(), true)?.version).toBe("0.1.0");
});
