import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { Dependencies, requiredEncoders, requiredFilters } from "./dependencies.js";
const capabilities = (names: string[]) =>
  names.map((name) => ` ... ${name} description`).join("\n");
it(
  "classifies missing, permissions, start failures and timeout using temporary executables",
  { timeout: 10000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "dependencies-"));
    try {
      const path = join(directory, "fake");
      const service = new Dependencies(() => {}, {
        candidates: (tool) => [join(directory, tool)],
        timeoutMs: 2000,
      });
      expect((await service.check()).tools.map((t) => t.failures)).toEqual([
        ["not-found"],
        ["not-found"],
      ]);
      await writeFile(path, "#!/bin/sh\nprintf 'ffmpeg version test\\n'\n", { mode: 0o600 });
      service.configure({ ffmpegPath: path, ffprobePath: path });
      expect((await service.check()).tools[0]?.failures).toEqual(["not-executable"]);
      await chmod(path, 0o700);
      await writeFile(path, "#!/bin/sh\nexit 1\n");
      expect((await service.check()).tools[0]?.failures).toContain("start-failed");
      await writeFile(path, "#!/bin/sh\nexec /bin/sleep 10\n");
      expect((await service.check()).tools[0]?.failures).toContain("timeout");
      await expect(service.requireReady()).rejects.toThrow("TOOLS_UNAVAILABLE");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
it("requires exact capability names, rechecks removed tools, and discards stale checks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dependency-state-"));
  try {
    const ffmpeg = join(directory, "ffmpeg"),
      ffprobe = join(directory, "ffprobe");
    await Promise.all([ffmpeg, ffprobe].map((path) => writeFile(path, "test", { mode: 0o700 })));
    let incomplete = false;
    let hold: (() => void) | undefined;
    let delay = false;
    const events: string[] = [];
    const service = new Dependencies((state) => events.push(state.status), {
      candidates: (tool) => [join(directory, tool)],
      run: async (path, args) => {
        if (delay && path === ffmpeg && args[0] === "-version") {
          delay = false;
          await new Promise<void>((resolve) => {
            hold = resolve;
          });
        }
        const text =
          args[0] === "-version"
            ? `${path === ffmpeg ? "ffmpeg" : "ffprobe"} version test`
            : args.includes("-encoders")
              ? capabilities(incomplete ? ["libx264_extra", "libx265", "aac"] : requiredEncoders)
              : capabilities(
                  incomplete ? requiredFilters.filter((f) => f !== "atrim") : requiredFilters,
                );
        return { stdout: text, stderr: "" };
      },
    });
    expect((await service.check()).status).toBe("ready");
    incomplete = true;
    const missing = await service.check();
    expect(missing.tools[0]?.missingEncoders).toEqual(["libx264"]);
    expect(missing.tools[0]?.missingFilters).toEqual(["atrim"]);
    incomplete = false;
    delay = true;
    const old = service.check();
    while (!hold) await new Promise((resolve) => setTimeout(resolve, 1));
    service.configure({ ffmpegPath: join(directory, "missing"), ffprobePath: ffprobe });
    await service.check();
    hold();
    await old;
    expect(service.snapshot().status).toBe("unavailable");
    service.configure({ ffmpegPath: ffmpeg, ffprobePath: ffprobe });
    await service.requireReady();
    await rm(ffprobe);
    await expect(service.requireReady()).rejects.toThrow("TOOLS_UNAVAILABLE");
    expect(events).toContain("checking");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("bounds both capability processes when one fails before the other times out", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dependency-timeout-"));
  try {
    await writeFile(
      join(directory, "ffmpeg"),
      '#!/bin/sh\ncase "$*" in\n*-version*) printf "ffmpeg version test\\n";;\n*-encoders*) exit 1;;\n*) exec /bin/sleep 10;;\nesac\n',
      { mode: 0o700 },
    );
    await writeFile(join(directory, "ffprobe"), '#!/bin/sh\nprintf "ffprobe version test\\n"\n', {
      mode: 0o700,
    });
    const service = new Dependencies(() => {}, {
      candidates: (tool) => [join(directory, tool)],
      timeoutMs: 2000,
    });
    const state = await service.check();
    expect(state.tools[0]?.failures).toEqual(["timeout"]);
    expect(state.tools[1]?.failures).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("shares in-flight checks so concurrent media requests cannot reject each other as checking", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dependency-concurrent-"));
  try {
    await Promise.all(
      ["ffmpeg", "ffprobe"].map((tool) =>
        writeFile(join(directory, tool), "test", { mode: 0o700 }),
      ),
    );
    let calls = 0;
    const service = new Dependencies(() => {}, {
      candidates: (tool) => [join(directory, tool)],
      run: async (path, args) => {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
          stdout:
            args[0] === "-version"
              ? `${path.endsWith("ffmpeg") ? "ffmpeg" : "ffprobe"} version test`
              : capabilities(args.includes("-encoders") ? requiredEncoders : requiredFilters),
          stderr: "",
        };
      },
    });
    const results = await Promise.all(Array.from({ length: 5 }, () => service.requireReady()));
    expect(calls).toBe(4);
    expect(results.every((r) => r.ffmpegPath === join(directory, "ffmpeg"))).toBe(true);
    await service.requireReady();
    expect(calls).toBe(8);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
