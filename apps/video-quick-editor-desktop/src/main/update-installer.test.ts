import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { downloadInstaller } from "./update-installer.js";

const content = "test installer bytes";
const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
const metadata = (overrides = {}) => ({
  tag_name: "v0.1.3",
  draft: false,
  assets: [
    {
      name: "Video-Quick-Editor-0.1.3-mac-arm64.dmg",
      state: "uploaded",
      size: Buffer.byteLength(content),
      digest,
      ...overrides,
    },
  ],
});

it("downloads only the selected GitHub asset, verifies it and opens the local DMG", async () => {
  const directory = await mkdtemp(join(tmpdir(), "update-test-"));
  try {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(metadata()))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://release-assets.githubusercontent.com/test" },
        }),
      )
      .mockResolvedValueOnce(new Response(content));
    const open = vi.fn(async (path: string) => {
      expect(await readFile(path, "utf8")).toBe(content);
      expect(path).toMatch(/Video-Quick-Editor-0\.1\.3-mac-arm64\.dmg$/);
      return "";
    });
    const progress = vi.fn();
    await downloadInstaller("0.1.3", directory, progress, open, request);
    expect(request.mock.calls[1]![0]).toBe(
      "https://github.com/GrahamQuan/video-quick-editor/releases/download/v0.1.3/Video-Quick-Editor-0.1.3-mac-arm64.dmg",
    );
    expect(open).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenLastCalledWith(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("rejects invalid hashes, sizes, off-host redirects and failed opening, cleaning partial files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "update-test-"));
  try {
    for (const scenario of ["hash", "size", "redirect", "open", "missing-digest"]) {
      const open = vi.fn(async () => (scenario === "open" ? "Cannot open" : ""));
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json(metadata(scenario === "missing-digest" ? { digest: null } : {})),
        )
        .mockResolvedValueOnce(
          scenario === "redirect"
            ? new Response(null, {
                status: 302,
                headers: { location: "https://evil.invalid/file" },
              })
            : new Response(
                scenario === "hash"
                  ? "x".repeat(content.length)
                  : scenario === "size"
                    ? content + "extra"
                    : content,
              ),
        );
      await expect(
        downloadInstaller("0.1.3", directory, () => {}, open, request),
      ).rejects.toThrow();
      expect(open).toHaveBeenCalledTimes(scenario === "open" ? 1 : 0);
      expect(await readdir(directory)).toEqual([]);
      expect(
        request.mock.calls.some(([url]) => typeof url === "string" && url.includes("evil.invalid")),
      ).toBe(false);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
