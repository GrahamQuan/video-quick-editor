import { _electron as electron, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

test("selected clip playback respects in/out points and replay after edits", async ({
  browserName,
}, testInfo) => {
  void browserName;
  await mkdir(testInfo.outputPath(), { recursive: true });
  const fixture = testInfo.outputPath("trim.mp4");
  execFileSync(
    "/opt/homebrew/bin/ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=160x120:r=25:d=4",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      fixture,
    ],
    { stdio: "ignore" },
  );
  const application = await electron.launch({
    executablePath: resolve(
      "release/mac-arm64/Video Quick Editor.app/Contents/MacOS/Video Quick Editor",
    ),
    args: [`--user-data-dir=${testInfo.outputPath("user-data")}`],
  });
  try {
    const page = await application.firstWindow();
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, fixture);
    await page.getByRole("button", { name: "＋", exact: true }).click();
    const video = page.getByRole("group", { name: "Media player", exact: true }).locator("video");
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
      .toBeGreaterThanOrEqual(2);
    const setRange = async (startUs: number, endUs: number, duplicate = false): Promise<void> => {
      await page.evaluate(
        async ({ startUs, endUs, duplicate }) => {
          const draft = await window.videoQuickEditor.getDraft();
          const clip = { ...draft.request.clips[0]!, startUs, endUs };
          await window.videoQuickEditor.updateDraft({
            expectedRevision: draft.revision,
            selectedClipId: clip.id,
            request: {
              ...draft.request,
              clips: duplicate ? [clip, { ...clip, id: crypto.randomUUID() }] : [clip],
            },
          });
        },
        { startUs, endUs, duplicate },
      );
      await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
        .toBeCloseTo(startUs / 1e6, 2);
    };
    await setRange(1_000_000, 2_000_000);
    for (let replay = 0; replay < 2; replay++) {
      await video.evaluate(async (v: HTMLVideoElement) => {
        await v.play();
      });
      await expect
        .poll(() =>
          video.evaluate(
            (v: HTMLVideoElement) => !v.paused && v.currentTime >= 1 && v.currentTime < 2,
          ),
        )
        .toBe(true);
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
      expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(2, 2);
    }
    await setRange(2_500_000, 3_500_000, true);
    const text = page.getByPlaceholder("Enter a single-line watermark");
    await page.getByRole("checkbox").click();
    await expect(page.getByRole("checkbox")).toBeChecked();
    await text.fill("Only first clip");
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.videoQuickEditor.getDraft()).request.clips[0]?.watermark?.text,
        ),
      )
      .toBe("Only first clip");
    await page.getByRole("article").nth(1).click();
    await expect(text).toHaveValue("");
    await expect(page.getByRole("checkbox")).not.toBeChecked();
    await page.getByRole("checkbox").click();
    await expect(page.getByRole("checkbox")).toBeChecked();
    await text.fill("Only second clip");
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.videoQuickEditor.getDraft()).request.clips[1]?.watermark?.text,
        ),
      )
      .toBe("Only second clip");
    await page.getByRole("article").nth(0).click();
    await expect(text).toHaveValue("Only first clip");

    await video.evaluate(async (v: HTMLVideoElement) => {
      v.currentTime = 0;
      await v.play();
    });
    await expect
      .poll(() =>
        video.evaluate(
          (v: HTMLVideoElement) => !v.paused && v.currentTime >= 2.5 && v.currentTime < 3.5,
        ),
      )
      .toBe(true);
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(3.5, 2);
  } finally {
    await application.close();
  }
});
