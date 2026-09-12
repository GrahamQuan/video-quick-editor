import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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
    await app.evaluate(
      ({ shell }, input) => {
        const g = globalThis as typeof globalThis & {
          updateRequests: string[];
          updateOpened: string[];
          installerOpened: string[];
        };
        g.updateRequests = [];
        g.updateOpened = [];
        g.installerOpened = [];
        globalThis.fetch = async (url) => {
          if (typeof url !== "string") throw new Error("Expected a fixed GitHub URL");
          g.updateRequests.push(url);
          if (url.includes("/releases/download/")) return new Response("test installer");
          const releases = [
            {
              tag_name: "v99.0.0",
              draft: false,
              prerelease: false,
              html_url: "https://evil.invalid/ignored",
              assets: [
                {
                  name: "Video-Quick-Editor-99.0.0-mac-arm64.dmg",
                  state: "uploaded",
                  size: 14,
                  digest: input.digest,
                },
              ],
            },
          ];
          return Response.json(url.includes("/releases/tags/") ? releases[0] : releases);
        };
        shell.openPath = async (path) => {
          g.installerOpened.push(path);
          return "";
        };
        shell.openExternal = async (url) => {
          g.updateOpened.push(url);
        };
      },
      {
        digest: `sha256:${createHash("sha256").update("test installer").digest("hex")}`,
      },
    );
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
    await page.getByRole("link", { name: "Edit", exact: true }).click();
    await app.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu()!;
      const items = menu.items[0]!.submenu!.items;
      if (items[0]!.label !== "About Video Quick Editor" || items[1]!.id !== "check-for-updates")
        throw new Error("Update item must follow About");
      const item = menu.getMenuItemById("check-for-updates")!;
      if (item.label !== "Check for Updates…") throw new Error("Incorrect update label");
      item.click();
    });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("status")).toContainText("99.0.0");
    await panel.getByRole("button", { name: "Open GitHub download page" }).click();
    await expect
      .poll(() =>
        app.evaluate(() => (globalThis as unknown as { updateOpened: string[] }).updateOpened),
      )
      .toEqual(["https://github.com/GrahamQuan/video-quick-editor/releases/tag/v99.0.0"]);
    await panel.getByRole("button", { name: "Download and open installer" }).click();
    await expect(panel.getByText(/^Installer opened/)).toBeVisible();
    const paths = await app.evaluate(
      () => (globalThis as unknown as { installerOpened: string[] }).installerOpened,
    );
    expect(paths).toHaveLength(1);
    expect(await readFile(paths[0]!, "utf8")).toBe("test installer");
    await page.getByLabel("Language", { exact: true }).selectOption("zh-CN");
    await expect(page.getByRole("heading", { name: "应用更新", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "打开 GitHub 下载页" })).toBeVisible();
    await page.getByRole("link", { name: "编辑", exact: true }).click();
    await app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()!.getMenuItemById("check-for-updates")!;
      if (item.label !== "检查更新…") throw new Error("Menu language did not update");
      item.click();
    });
    await expect(page.getByRole("heading", { name: "应用更新", exact: true })).toBeVisible();
    // close() starts an asynchronous native close. Wait until the old window is
    // gone before testing a menu click with no window, especially on CI runners.
    const closed = page.waitForEvent("close");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    await closed;
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(0);
    const newWindow = app.waitForEvent("window");
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.getMenuItemById("check-for-updates")!.click(),
    );
    const reopened = await newWindow;
    await expect(reopened.getByRole("heading", { name: "应用更新", exact: true })).toBeVisible();
    await expect(
      reopened.getByRole("region", { name: "应用更新", exact: true }).getByRole("status"),
    ).toContainText("99.0.0");
  } finally {
    await app.close();
  }
});
