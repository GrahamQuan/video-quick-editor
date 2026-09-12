import { _electron as electron, expect, test } from "@playwright/test";
import { resolve } from "node:path";

test("checks updates on demand, opens only the verified release and supports Chinese", async ({
  browserName,
}, info) => {
  void browserName;
  const app = await electron.launch({
    executablePath: resolve(
      "release/mac-arm64/Video Quick Editor.app/Contents/MacOS/Video Quick Editor",
    ),
    args: [`--user-data-dir=${info.outputPath("user-data")}`],
  });
  try {
    const page = await app.firstWindow();
    // Stub the network in main, retaining the actual update service and IPC.
    await app.evaluate(({ shell }) => {
      const g = globalThis as typeof globalThis & {
        updateRequests: string[];
        updateOpened: string[];
      };
      g.updateRequests = [];
      g.updateOpened = [];
      globalThis.fetch = async (url) => {
        if (typeof url !== "string") throw new Error("Expected a fixed GitHub URL");
        g.updateRequests.push(url);
        return Response.json([
          {
            tag_name: "v99.0.0",
            draft: false,
            prerelease: false,
            html_url: "https://evil.invalid/ignored",
            assets: [
              { name: "Video-Quick-Editor-99.0.0-mac-arm64.dmg", state: "uploaded", size: 123 },
            ],
          },
        ]);
      };
      shell.openExternal = async (url) => {
        g.updateOpened.push(url);
      };
    });
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    const panel = page.getByRole("region", { name: "App updates", exact: true });
    await expect(
      panel.getByRole("button", { name: "Check for updates", exact: true }),
    ).toBeEnabled();
    expect(
      await app.evaluate(
        () => (globalThis as unknown as { updateRequests: string[] }).updateRequests,
      ),
    ).toEqual([]);
    const invalid = await page.evaluate(async () => {
      try {
        await window.videoQuickEditor.checkAppUpdate("bad" as unknown as boolean);
        return false;
      } catch {
        return true;
      }
    });
    expect(invalid).toBe(true);
    await panel.getByRole("button", { name: "Check for updates", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("99.0.0");
    await panel.getByRole("button", { name: "Open GitHub download page" }).click();
    await expect
      .poll(() =>
        app.evaluate(() => (globalThis as unknown as { updateOpened: string[] }).updateOpened),
      )
      .toEqual(["https://github.com/GrahamQuan/video-quick-editor/releases/tag/v99.0.0"]);
    await page.getByLabel("Language", { exact: true }).selectOption("zh-CN");
    await expect(page.getByRole("heading", { name: "应用更新", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "打开 GitHub 下载页" })).toBeVisible();
  } finally {
    await app.close();
  }
});
