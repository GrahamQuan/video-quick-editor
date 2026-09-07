import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { it, expect } from "vitest";
import { resolveImportPaths } from "./import-paths.js";
import { parseImportPathText } from "@video-quick-editor/shared";

it("recognizes path-only messages without treating prose as an import", () => {
  expect(parseImportPathText('"/tmp/my clip.mp4"\n~/Movies')).toEqual([
    "/tmp/my clip.mp4",
    "~/Movies",
  ]);
  expect(parseImportPathText("Please trim the first clip")).toBeNull();
});
it("imports only top-level videos in natural order, deduplicates paths, rejects invalid inputs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "path-import-"));
  try {
    await mkdir(join(dir, "nested"));
    for (const name of ["video10.MP4", "video2.mov", ".hidden.mp4", "notes.txt", "nested/deep.mp4"])
      await writeFile(join(dir, name), "fixture");
    await symlink(join(dir, "video2.mov"), join(dir, "link.mov"));
    const files = await resolveImportPaths([dir, pathToFileURL(join(dir, "video2.mov")).href]);
    expect(files.map((file) => file.split("/").pop())).toEqual(["video2.mov", "video10.MP4"]);
    await expect(resolveImportPaths([join(dir, "notes.txt")])).rejects.toThrow("Only MP4");
    await expect(resolveImportPaths(["relative.mp4"])).rejects.toThrow("absolute");
    await expect(resolveImportPaths([join(dir, "missing")])).rejects.toThrow();
    await expect(resolveImportPaths(Array.from({ length: 101 }, () => dir))).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
