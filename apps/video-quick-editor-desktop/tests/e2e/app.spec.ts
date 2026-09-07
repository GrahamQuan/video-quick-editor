import { _electron as electron, expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";

test("Electron app、Video.js、双语设置持久化与安全 preload 可用", async ({
  browserName,
}, testInfo) => {
  void browserName;
  const executablePath = resolve(
    "release/mac-arm64/Video Quick Editor.app/Contents/MacOS/Video Quick Editor",
  );
  const userDataDirectory = testInfo.outputPath("user-data");
  let application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataDirectory}`],
  });
  try {
    const page = await application.firstWindow();
    await expect(page.getByRole("link", { name: /Video Quick Editor/u })).toBeVisible();
    await expect(page.getByText("Add a video from the left to begin")).toBeVisible();
    await expect(page.getByText("✂ Trim")).toBeVisible();
    await expect(page.getByText("⧉ Combine")).toBeVisible();
    await page.getByRole("link", { name: "Exports" }).click();
    await expect(page.getByRole("heading", { name: "Export queue" })).toBeVisible();
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "FFmpeg settings" })).toBeVisible();
    await page.getByLabel("Language").selectOption("zh-CN");
    await expect(page.getByRole("heading", { name: "FFmpeg 设置" })).toBeVisible();
    const security = await page.evaluate(() => ({
      hasApi: typeof window.videoQuickEditor?.getSettings === "function",
      hasRequire: "require" in window,
    }));
    expect(security).toEqual({ hasApi: true, hasRequire: false });
  } finally {
    await application.close();
  }

  application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataDirectory}`],
  });
  try {
    const page = await application.firstWindow();
    await expect(page.getByRole("link", { name: "设置" })).toBeVisible();
    await page.getByRole("link", { name: "设置" }).click();
    await expect(page.getByLabel("语言")).toHaveValue("zh-CN");
  } finally {
    await application.close();
  }
});

test("side chat preserves draft through navigation, toggle, narrow windows and language changes", async ({
  browserName,
}, testInfo) => {
  void browserName;
  const application = await electron.launch({
    executablePath: resolve(
      "release/mac-arm64/Video Quick Editor.app/Contents/MacOS/Video Quick Editor",
    ),
    args: [`--user-data-dir=${testInfo.outputPath("chat-user-data")}`],
  });
  try {
    const page = await application.firstWindow();
    await expect(page.locator("#agent-chat")).toBeHidden();
    await page.getByRole("button", { name: "Show chat", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    await expect(input).toBeFocused();
    await input.fill("Keep this draft");
    await expect(page.getByRole("button", { name: "Hide chat", exact: true })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await page.getByRole("button", { name: "Close chat", exact: true }).click();
    await expect(page.getByRole("button", { name: "Show chat", exact: true })).toBeFocused();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Show chat", exact: true }).click();
    await expect(input).toHaveValue("Keep this draft");
    await page.getByRole("button", { name: "Hide chat", exact: true }).click();
    await page.getByLabel("Language", { exact: true }).selectOption("zh-CN");
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.setSize(820, 760),
    );
    await page.getByRole("button", { name: "显示聊天", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).toHaveValue(
      "Keep this draft",
    );
    await page.getByRole("button", { name: "关闭聊天", exact: true }).click();
    await expect(page.locator("#agent-chat")).toBeHidden();
  } finally {
    await application.close();
  }
});

test("mock model tool loop updates the same draft as manual editing", async ({
  browserName,
}, testInfo) => {
  void browserName;
  test.setTimeout(60000);
  const { createServer } = await import("node:http");
  const { execFileSync } = await import("node:child_process");
  const fixture = testInfo.outputPath("fixture.mp4");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(testInfo.outputPath(), { recursive: true });
  execFileSync(
    "/opt/homebrew/bin/ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=s=320x240:r=25:d=2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      fixture,
    ],
    { stdio: "ignore" },
  );
  let calls = 0;
  const modelRequests: string[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body);
    modelRequests.push(body);
    calls++;
    const previous = parsed.messages.filter((m: { role: string }) => m.role === "tool");
    let delta: unknown;
    let finish = "tool_calls";
    if (!previous.length)
      delta = {
        content: "I will inspect the editor first.",
        tool_calls: [
          {
            index: 0,
            id: "context-call",
            type: "function",
            function: { name: "get_editor_context", arguments: "{}" },
          },
        ],
      };
    else if (previous.length === 1) {
      const context = JSON.parse(previous[0].content).data;
      delta = {
        tool_calls: [
          {
            index: 0,
            id: "timeline-call",
            type: "function",
            function: {
              name: "set_timeline",
              arguments: JSON.stringify({
                expectedRevision: context.draft.revision,
                clips: context.draft.request.clips.map((c: object) => ({
                  ...c,
                  startUs: 500000,
                  endUs: 1500000,
                })),
              }),
            },
          },
        ],
      };
    } else {
      delta = {
        content: [
          "## Edit complete",
          "",
          "Trim updated. No export started.",
          "",
          "- 保留**中间片段**，检查 `startUs`。",
          "",
          "| Start | End |",
          "| --- | --- |",
          "| 0.5 s | 1.5 s |",
          "",
          "```json",
          '{"startUs":500000,"endUs":1500000}',
          "```",
          "",
          "[Reference](https://example.com)",
          "![remote](https://example.com/private.png)",
          "<script>window.markdownExecuted = true</script>",
        ].join("\n"),
      };
      finish = "stop";
    }
    if (calls === 9) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (res.destroyed) return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const chunks =
      finish === "stop" && "content" in (delta as { content?: string })
        ? [
            (delta as { content: string }).content.slice(0, 65),
            (delta as { content: string }).content.slice(65),
          ]
        : null;
    for (const event of [
      ...(chunks
        ? chunks.map((content) => ({
            choices: [{ index: 0, delta: { content }, finish_reason: null }],
          }))
        : [{ choices: [{ index: 0, delta, finish_reason: null }] }]),
      { choices: [{ index: 0, delta: {}, finish_reason: finish }] },
    ])
      res.write(
        `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 1, model: "mock", ...event })}\n\n`,
      );
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Server address missing");
  const application = await electron.launch({
    executablePath: resolve(
      "release/mac-arm64/Video Quick Editor.app/Contents/MacOS/Video Quick Editor",
    ),
    args: [`--user-data-dir=${testInfo.outputPath("agent-user-data")}`],
  });
  try {
    const page = await application.firstWindow();
    await application.evaluate(({ dialog, safeStorage }, path) => {
      // Only this mock test process uses a fake credential store; production has no fallback.
      safeStorage.isEncryptionAvailable = () => true;
      safeStorage.encryptString = (value) => Buffer.from(value).reverse();
      safeStorage.decryptString = (value) => Buffer.from(value).reverse().toString();
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, fixture);
    await page.getByRole("button", { name: "Show chat", exact: true }).click();
    await page.getByRole("textbox", { name: "Message", exact: true }).fill(`"${dirname(fixture)}"`);
    await page.getByRole("button", { name: "Import paths", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("");
    expect(calls).toBe(0);
    await expect
      .poll(
        async () =>
          await page.evaluate(
            async () => (await window.videoQuickEditor.getDraft()).request.clips.length,
          ),
      )
      .toBe(1);
    const defaultFont = await page.evaluate(async () => {
      const settings = await window.videoQuickEditor.getSettings();
      const draft = await window.videoQuickEditor.getDraft();
      return {
        settingsId: settings.defaultFontId,
        draftId: draft.request.watermark.fontId,
        name: settings.defaultFontName,
      };
    });
    expect(defaultFont.settingsId).toBeTruthy();
    expect(defaultFont.draftId).toBe(defaultFont.settingsId);
    expect(defaultFont.name).toBeTruthy();
    const preview = await page.evaluate(async () => {
      const draft = await window.videoQuickEditor.getDraft();
      const watermark = { ...draft.request.watermark, enabled: true, text: "旅行记录 Hello" };
      const next = await window.videoQuickEditor.updateDraft({
        expectedRevision: draft.revision,
        selectedClipId: draft.selectedClipId,
        request: { ...draft.request, watermark },
      });
      const url = await window.videoQuickEditor.previewFrame({
        assetId: next.request.clips[0]!.assetId,
        atUs: 0,
        watermark,
      });
      const image = new Image();
      image.src = url;
      await image.decode();
      const plan = await window.videoQuickEditor.planExport(next.request);
      return {
        imageWidth: image.naturalWidth,
        duration: plan.expectedDurationUs,
      };
    });
    expect(preview.imageWidth).toBe(320);
    expect(preview.duration).toBe(2_000_000);
    await page.evaluate(async (baseURL) => {
      await window.videoQuickEditor.saveModel({
        baseURL,
        modelId: "mock",
        apiKey: "mock-test-key",
      });
    }, `http://127.0.0.1:${address.port}/prefix`);
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill(
        `视频剪辑和拼接\n1. ’${fixture}‘，这个视频从 0.5 秒到 1.5 秒\n2. ‘${fixture}’ 这个视频从 0.5 秒到 1.5 秒\n剪辑完成后拼接，不要导出`,
      );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Trim updated. No export started.", { exact: true })).toBeVisible();
    expect(calls).toBe(3);
    const importedDraft = await page.evaluate(() => window.videoQuickEditor.getDraft());
    expect(importedDraft.request.clips).toHaveLength(3);
    const initialMessages = JSON.parse(modelRequests[0]!).messages;
    const editorState = initialMessages.find((m: { content: string }) =>
      m.content.startsWith("Current editor state"),
    );
    expect(
      JSON.parse(editorState.content.slice(editorState.content.indexOf("{"))).assets,
    ).toHaveLength(3);
    expect(modelRequests[0]).toContain("Local import already completed");
    expect(modelRequests.join("\n")).not.toContain(dirname(fixture));
    const messages = page.locator(".chat-message");
    await expect(messages.last()).toContainText("Trim updated. No export started.");
    await expect(messages.last().getByRole("heading", { name: "Edit complete" })).toBeVisible();
    await expect(messages.last().locator('[data-streamdown="strong"]')).toHaveText("中间片段");
    await expect(messages.last().getByRole("table")).toContainText("0.5 s");
    await expect(messages.last().locator("pre")).toContainText('"startUs":500000');
    await expect(
      messages.last().getByRole("button", { name: "Copy code", exact: true }),
    ).toBeVisible();
    await expect(messages.last().locator("img, script, a[href]")).toHaveCount(0);
    await messages.last().locator("pre").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("streamdown-chat.png") });
    await expect(page.locator(".chat-message.tool details")).toHaveCount(2);
    expect(await page.locator(".chat-message.tool details[open]").count()).toBe(0);
    const session = await page.evaluate(() => window.videoQuickEditor.getAgentSession());
    expect(session.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "tool",
      "assistant",
    ]);
    expect(session.running).toBe(false);
    const draft = await page.evaluate(() => window.videoQuickEditor.getDraft());
    expect(draft.request.clips[0]).toMatchObject({ startUs: 500000, endUs: 1500000 });
    expect(await page.evaluate(() => window.videoQuickEditor.getJobs())).toHaveLength(0);
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Unsent text");
    await page.getByRole("button", { name: "Clear chat", exact: true }).click();
    await expect(messages).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("");
    expect(await page.evaluate(() => window.videoQuickEditor.getDraft())).toEqual(draft);
    expect(await page.evaluate(() => window.videoQuickEditor.getAgentSession())).toEqual({
      messages: [],
      running: false,
    });
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Keep the current trim.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(messages.last()).toContainText("Trim updated. No export started.");
    await expect.poll(() => calls).toBe(6);
    expect(modelRequests[3]).not.toContain("视频剪辑和拼接");
    expect(
      JSON.parse(modelRequests[3]!).messages.some((m: { role: string }) => m.role === "tool"),
    ).toBe(false);
    await page.getByRole("button", { name: "Clear chat", exact: true }).click();
    await expect(messages).toHaveCount(0);
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Keep the current trim again.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect.poll(() => calls).toBe(9);
    await page.getByRole("button", { name: "Clear chat", exact: true }).click();
    await expect(messages).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Hide chat", exact: true }).click();
    await expect(page.locator('input[value="00:00:00.500"]')).toBeVisible();
    const video = page.getByRole("group", { name: "Media player", exact: true }).locator("video");
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
      .toBeGreaterThanOrEqual(1);
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeCloseTo(0.5, 2);
    await video.evaluate(async (element: HTMLVideoElement) => {
      element.currentTime = 0;
      await element.play();
    });
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThanOrEqual(0.5);
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.paused))
      .toBe(true);
    expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(
      1.5,
      2,
    );
    await video.evaluate(async (element: HTMLVideoElement) => {
      await element.play();
    });
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeLessThan(1.5);
    await video.evaluate((element: HTMLVideoElement) => element.pause());
    const ruler = page.getByTestId("trim-ruler-track");
    const start = page.getByRole("slider", { name: "In point", exact: true });
    const end = page.getByRole("slider", { name: "Out point", exact: true });
    const box = await ruler.boundingBox();
    if (!box) throw new Error("Ruler not visible");
    const handle = await start.boundingBox();
    if (!handle) throw new Error("Start handle missing");
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.1, handle.y + handle.height / 2, { steps: 5 });
    await expect(page.getByRole("textbox", { name: "In point", exact: true })).toHaveValue(
      "00:00:00.200",
    );
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          await page.evaluate(
            async () => (await window.videoQuickEditor.getDraft()).request.clips[0]!.startUs,
          ),
      )
      .toBeCloseTo(200000, -3);
    const endBox = await end.boundingBox();
    if (!endBox) throw new Error("End handle missing");
    await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, endBox.y + endBox.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByRole("textbox", { name: "Out point", exact: true })).toHaveValue(
      "00:00:01.600",
    );
    await page.getByRole("textbox", { name: "Out point", exact: true }).fill("00:00:01.200");
    await page.getByRole("textbox", { name: "Out point", exact: true }).press("Tab");
    await expect(end).toHaveAttribute("aria-valuenow", "1.2");
    await start.focus();
    await start.press("ArrowRight");
    await expect
      .poll(async () => Number(await start.getAttribute("aria-valuenow")))
      .toBeCloseTo(0.3, 3);
    await end.focus();
    await end.press("End");
    await expect(end).toHaveAttribute("aria-valuenow", "2");
    await page
      .getByRole("group", { name: "Trim range", exact: true })
      .screenshot({ path: testInfo.outputPath("trim-range.png") });
  } finally {
    await application.close();
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  }
});
