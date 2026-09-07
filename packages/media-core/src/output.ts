import { timestampOutputName } from "@video-quick-editor/shared";
import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";

export function defaultOutputName(
  firstFileName: string,
  _clipCount: number,
  outputProfile: string = "source",
): string {
  return timestampOutputName(firstFileName, outputProfile);
}

export async function allocateOutputPath(
  directory: string,
  requestedName: string,
): Promise<string> {
  const extension = extname(requestedName);
  const stem = basename(requestedName, extension);
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = join(directory, `${stem}${index === 1 ? "" : `_${index}`}${extension}`);
    try {
      await access(candidate, constants.F_OK);
    } catch {
      return candidate;
    }
  }
  throw new Error("无法分配不重名的输出文件名");
}

export async function assertOutputNotInput(
  outputPath: string,
  inputPaths: string[],
): Promise<void> {
  const normalizedOutput = resolve(outputPath);
  if (inputPaths.some((input) => resolve(input) === normalizedOutput))
    throw new Error("输出不能覆盖输入文件");
  try {
    const [outputReal, outputStat] = await Promise.all([realpath(outputPath), lstat(outputPath)]);
    for (const input of inputPaths) {
      const [inputReal, inputStat] = await Promise.all([realpath(input), lstat(input)]);
      if (
        inputReal === outputReal ||
        (inputStat.dev === outputStat.dev && inputStat.ino === outputStat.ino)
      )
        throw new Error("输出与输入指向同一文件");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("输出与输入")) throw error;
  }
  if (dirname(normalizedOutput) === normalizedOutput) throw new Error("输出路径无效");
}
