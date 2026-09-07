import { _electron as electron, expect, test } from "@playwright/test";
import { resolve } from "node:path";

test("未签名 macOS .app、hash routes 与安全 preload 可用", async () => {
  const executablePath = resolve(
    "release/mac-arm64/Video Quick Editor.app/Contents/MacOS/Video Quick Editor",
  );
  const application = await electron.launch({ executablePath });
  try {
    const page = await application.firstWindow();
    await expect(page.getByRole("link", { name: /Video Quick Editor/u })).toBeVisible();
    await expect(page.getByText("从左侧添加视频开始")).toBeVisible();
    await expect(page.getByText("✂ 裁剪")).toBeVisible();
    await expect(page.getByText("⧉ 组合")).toBeVisible();
    await page.getByRole("link", { name: "导出" }).click();
    await expect(page.getByRole("heading", { name: "导出任务队列" })).toBeVisible();
    await page.getByRole("link", { name: "设置" }).click();
    await expect(page.getByRole("heading", { name: "FFmpeg 设置" })).toBeVisible();
    const security = await page.evaluate(() => ({
      hasApi: typeof window.videoQuickEditor?.getSettings === "function",
      hasRequire: "require" in window,
    }));
    expect(security).toEqual({ hasApi: true, hasRequire: false });
  } finally {
    await application.close();
  }
});
