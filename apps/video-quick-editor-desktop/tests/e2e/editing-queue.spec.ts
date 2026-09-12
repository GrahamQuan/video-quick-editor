import { _electron as electron, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

test("explicit trim/combine selection and session FIFO exports use only their frozen clips", async ({
  browserName,
}, testInfo) => {
  void browserName;
  test.setTimeout(90000);
  const directory = testInfo.outputPath();
  await mkdir(directory, { recursive: true });
  const downloads = join(directory, "downloads");
  await mkdir(downloads);
  const files = ["A", "B", "C", "D"].map((name) => join(directory, `${name}.mp4`));
  for (const [index, color] of ["red", "green", "yellow", "blue"].entries()) {
    execFileSync(
      "/opt/homebrew/bin/ffmpeg",
      [
        "-nostdin",
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=${color}:s=160x120:r=25:d=3`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        files[index]!,
      ],
      { stdio: "ignore" },
    );
  }
  const gate = join(directory, "release");
  const wrapper = join(directory, "ffmpeg-gate");
  await writeFile(
    wrapper,
    `#!/bin/sh\nfor arg in "$@"; do\n if [ "$arg" = "-progress" ]; then\n  while [ ! -f '${gate.replaceAll("'", "'\\''")}' ]; do sleep 0.05; done\n fi\ndone\nexec /opt/homebrew/bin/ffmpeg "$@"\n`,
    { mode: 0o700 },
  );
  const application = await electron.launch({
    executablePath: resolve(
      "release/mac-arm64/Video Quick Editor.app/Contents/MacOS/Video Quick Editor",
    ),
    args: [`--user-data-dir=${join(directory, "user-data")}`],
  });
  try {
    await application.evaluate(({ app }, path) => app.setPath("downloads", path), downloads);
    const page = await application.firstWindow();
    await page.evaluate(async (path) => {
      await window.videoQuickEditor.updateSettings({
        ffmpegPath: path,
        ffprobePath: "/opt/homebrew/bin/ffprobe",
      });
      await window.videoQuickEditor.checkTools();
    }, wrapper);
    const trim = page.getByRole("tab", { name: "✂ Trim", exact: true });
    const combine = page.getByRole("tab", { name: "⧉ Combine", exact: true });
    await expect(trim).toHaveAttribute("aria-selected", "true");
    await expect(combine).toBeDisabled();
    const add = async (index: number) => {
      await application.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      }, files[index]!);
      await page.getByRole("button", { name: "＋", exact: true }).click();
      await expect(
        page.locator("article strong").filter({ hasText: `${["A", "B", "C", "D"][index]}.mp4` }),
      ).toBeVisible();
    };
    await add(0);
    await expect(combine).toBeDisabled();
    await add(1);
    await expect(trim).toHaveAttribute("aria-selected", "true");
    await combine.click();
    await expect(
      page.getByRole("list", { name: "Combine order", exact: true }).locator("li"),
    ).toHaveCount(2);
    await add(2);
    await expect(
      page.getByRole("checkbox", { name: "Combine A.mp4 1", exact: true }),
    ).toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: "Combine C.mp4 3", exact: true }),
    ).not.toBeChecked();
    await page.getByRole("button", { name: "Clear selection", exact: true }).click();
    await expect(page.getByRole("button", { name: "Add combine to queue" })).toBeDisabled();
    await add(3);
    await trim.click();
    await page.locator("article strong").getByText("B.mp4", { exact: true }).click();
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const draft = await window.videoQuickEditor.getDraft();
          const assets = await window.videoQuickEditor.getAssets();
          return assets.find(
            (a) => a.id === draft.request.clips.find((c) => c.id === draft.selectedClipId)?.assetId,
          )?.fileName;
        }),
      )
      .toBe("B.mp4");
    await expect(page.getByRole("heading", { name: "B.mp4", exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "In point", exact: true }).fill("00:00:00.500");
    await expect(page.getByRole("textbox", { name: "In point", exact: true })).toHaveValue(
      "00:00:00.500",
    );
    await page.getByRole("textbox", { name: "Out point", exact: true }).click();
    await expect(page.getByRole("slider", { name: "In point", exact: true })).toHaveAttribute(
      "aria-valuenow",
      "0.5",
    );
    await page.getByRole("textbox", { name: "Out point", exact: true }).fill("00:00:01.500");
    await page.getByRole("heading", { name: "B.mp4", exact: true }).click();
    await page.getByRole("button", { name: "Add trim to queue" }).click();
    await expect(page.getByTestId("queue-toast")).toContainText("Added to queue");
    await expect(page.getByTestId("queue-toast")).toHaveCount(0, { timeout: 4500 });
    await expect(trim).toBeVisible();
    await combine.click();
    await page.getByRole("checkbox", { name: "Combine B.mp4 2", exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: "Combine B.mp4 2", exact: true }),
    ).toBeChecked();
    await expect(page.getByRole("button", { name: "Add combine to queue" })).toBeDisabled();
    await page.getByRole("checkbox", { name: "Combine D.mp4 4", exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: "Combine D.mp4 4", exact: true }),
    ).toBeChecked();
    await page.getByRole("button", { name: "Move up 2", exact: true }).click();
    await page.locator("article strong").getByText("A.mp4", { exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: "Combine A.mp4 1", exact: true }),
    ).not.toBeChecked();
    await page.getByRole("button", { name: "Add combine to queue" }).click();
    await expect
      .poll(async () => (await page.evaluate(() => window.videoQuickEditor.getJobs())).length)
      .toBe(2);
    await expect(page.getByTestId("queue-toast")).toContainText("Added to queue");
    await page.getByRole("button", { name: "Dismiss notification" }).click();
    await expect(page.getByTestId("queue-toast")).toHaveCount(0);
    const initial = await page.evaluate(() => window.videoQuickEditor.getJobs());
    expect(initial[0]!.request.taskKind).toBe("trim");
    expect(initial[0]!.clipNames).toEqual(["B.mp4"]);
    expect(initial[0]!.request.clips[0]).toMatchObject({ startUs: 500000, endUs: 1500000 });
    expect(initial[1]!.state).toBe("queued");
    expect(initial[1]!.clipNames).toEqual(["D.mp4", "B.mp4"]);
    expect(new Set(initial.map((job) => job.outputName)).size).toBe(2);
    await page.getByRole("button", { name: "Clear selection", exact: true }).click();
    await page.getByRole("checkbox", { name: "Combine A.mp4 1", exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: "Combine A.mp4 1", exact: true }),
    ).toBeChecked();
    await page.getByRole("checkbox", { name: "Combine C.mp4 3", exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: "Combine C.mp4 3", exact: true }),
    ).toBeChecked();
    await page.getByRole("button", { name: "Add combine to queue" }).click();
    await expect
      .poll(async () => (await page.evaluate(() => window.videoQuickEditor.getJobs())).length)
      .toBe(3);
    await trim.click();
    await page.getByRole("button", { name: "Add trim to queue" }).click();
    await expect
      .poll(async () => (await page.evaluate(() => window.videoQuickEditor.getJobs())).length)
      .toBe(4);
    await page.evaluate(async () => {
      const jobs = await window.videoQuickEditor.getJobs();
      await window.videoQuickEditor.cancelExport(jobs[3]!.id);
    });
    expect((await page.evaluate(() => window.videoQuickEditor.getJobs()))[3]!.state).toBe(
      "cancelled",
    );
    await page.reload();
    await expect(page.locator("article strong")).toHaveCount(4);
    await expect(page.getByTestId("queue-toast")).toHaveCount(0);
    await page.getByRole("link", { name: /^Exports/ }).click();
    await expect(page.getByText("Waiting position: 1", { exact: true })).toBeVisible();
    await writeFile(gate, "go");
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.videoQuickEditor.getJobs())).map((j) => j.state),
        { timeout: 30000 },
      )
      .toEqual(["completed", "completed", "completed", "cancelled"]);
    const jobs = await page.evaluate(() => window.videoQuickEditor.getJobs());
    expect(jobs[1]!.request.clips).toEqual(initial[1]!.request.clips);
    expect(jobs[2]!.clipNames).toEqual(["A.mp4", "C.mp4"]);
    for (const job of jobs.slice(0, 3)) {
      const probe = JSON.parse(
        execFileSync(
          "/opt/homebrew/bin/ffprobe",
          ["-v", "error", "-show_format", "-of", "json", job.resultPath!],
          { encoding: "utf8" },
        ),
      );
      const expected =
        job.request.clips.reduce((sum, clip) => sum + clip.endUs - clip.startUs, 0) / 1e6;
      expect(Math.abs(Number(probe.format.duration) - expected)).toBeLessThan(0.1);
      execFileSync(
        "/opt/homebrew/bin/ffmpeg",
        ["-v", "error", "-i", job.resultPath!, "-f", "null", "-"],
        { stdio: "ignore" },
      );
    }
    const pixel = (path: string, at: string) => [
      ...execFileSync("/opt/homebrew/bin/ffmpeg", [
        "-v",
        "error",
        "-ss",
        at,
        "-i",
        path,
        "-frames:v",
        "1",
        "-vf",
        "scale=1:1",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "-",
      ]),
    ];
    const green = pixel(jobs[0]!.resultPath!, "0.2");
    expect(green[1]!).toBeGreaterThan(green[0]! + 50);
    const blue = pixel(jobs[1]!.resultPath!, "0.2");
    expect(blue[2]!).toBeGreaterThan(blue[1]! + 50);
    const second = pixel(jobs[1]!.resultPath!, "3.2");
    expect(second[1]!).toBeGreaterThan(second[2]! + 50);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByLabel("Language", { exact: true }).selectOption("zh-CN");
    await page.getByRole("link", { name: "编辑", exact: true }).click();
    await expect(page.getByRole("button", { name: "加入裁剪队列" })).toBeVisible();
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.setSize(820, 760),
    );
    await expect(page.getByRole("tab", { name: "⧉ 组合", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("queue-editor-zh.png") });
  } finally {
    await writeFile(gate, "go");
    const page = await application.firstWindow();
    await page
      .evaluate(async () => {
        for (const job of await window.videoQuickEditor.getJobs())
          await window.videoQuickEditor.cancelExport(job.id);
      })
      .catch(() => {});
    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    await application.close();
  }
});
