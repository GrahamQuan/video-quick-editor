import { opendir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const supported = (path: string) => [".mp4", ".mov", ".mkv"].includes(extname(path).toLowerCase());
/** Expand only explicitly supplied directories, never traverse subdirectories. */
export async function resolveImportPaths(raw: unknown): Promise<string[]> {
  const inputs = z.array(z.string().min(1).max(4096)).min(1).max(100).parse(raw);
  const files = new Set<string>();
  async function add(path: string) {
    if (!supported(path))
      throw new Error("Only MP4, MOV and MKV files are supported / 仅支持 MP4、MOV、MKV 文件");
    files.add(await realpath(path));
    if (files.size > 100)
      throw new Error("Import at most 100 videos at once / 每次最多导入 100 个视频");
  }
  for (const input of inputs) {
    const path = input.startsWith("file:")
      ? fileURLToPath(input)
      : input.startsWith("~/")
        ? join(homedir(), input.slice(2))
        : input;
    if (!isAbsolute(path)) throw new Error("Use an absolute local path / 请使用本地绝对路径");
    const info = await stat(path);
    if (info.isDirectory()) {
      const children: string[] = [];
      const directory = await opendir(path);
      for await (const entry of directory) {
        if (entry.isFile() && !entry.name.startsWith(".") && supported(entry.name)) {
          children.push(join(path, entry.name));
          if (children.length > 100)
            throw new Error("Import at most 100 videos at once / 每次最多导入 100 个视频");
        }
      }
      children.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
      for (const child of children) await add(child);
    } else if (info.isFile()) await add(path);
    else throw new Error("Not a regular video file / 不是普通视频文件");
  }
  if (!files.size)
    throw new Error(
      "No MP4, MOV or MKV files in this folder / 文件夹第一层没有 MP4、MOV、MKV 视频",
    );
  return [...files];
}
