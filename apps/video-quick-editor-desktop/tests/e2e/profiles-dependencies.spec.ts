import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";

test("dependency blocking and recovery preserve multi-model settings and real media output", async ({
  browserName,
}, info) => {
  void browserName;
  test.setTimeout(90000);
  const data = info.outputPath("user-data");
  await mkdir(data, { recursive: true });
  const absent = info.outputPath("missing-ffmpeg");
  await writeFile(
    join(data, "settings.json"),
    JSON.stringify({
      ffmpegPath: absent,
      ffprobePath: absent,
      defaultFontId: null,
      language: "en",
      fonts: {},
    }),
  );
  const fixture = info.outputPath("fixture.mp4");
  execFileSync(
    "/opt/homebrew/bin/ffmpeg",
    [
      "-nostdin",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=160x120:r=25:d=2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      fixture,
    ],
    { stdio: "ignore" },
  );
  const executablePath = resolve(
    "release/mac-arm64/Video Quick Editor.app/Contents/MacOS/Video Quick Editor",
  );
  let app = await electron.launch({ executablePath, args: [`--user-data-dir=${data}`] });
  const patch = async () => {
    // Wait for app startup before evaluating Electron APIs through the debugger.
    await app.firstWindow();
    await app.evaluate(({ safeStorage }) => {
      safeStorage.isEncryptionAvailable = () => true;
      safeStorage.encryptString = (s) => Buffer.from(s).reverse();
      safeStorage.decryptString = (b) => Buffer.from(b).reverse().toString();
    });
  };
  try {
    await patch();
    const page = await app.firstWindow();
    await expect(page.getByRole("status", { name: "Media dependencies" })).toContainText(
      "Not found",
    );
    const blocked = await page.evaluate(async (path) => {
      const results = [];
      const request = (await window.videoQuickEditor.getDraft()).request;
      request.clips = [
        {
          id: "00000000-0000-4000-8000-000000000001",
          assetId: "00000000-0000-4000-8000-000000000002",
          startUs: 0,
          endUs: 1,
        },
      ];
      for (const operation of [
        () => window.videoQuickEditor.importLocalPaths([path]),
        () => window.videoQuickEditor.chooseAssets(),
        async () => window.videoQuickEditor.planExport(request),
        async () => window.videoQuickEditor.startExport(request),
      ]) {
        try {
          await operation();
          results.push("unexpected success");
        } catch (error) {
          results.push(String(error));
        }
      }
      return {
        results,
        draft: await window.videoQuickEditor.getDraft(),
        jobs: await window.videoQuickEditor.getJobs(),
      };
    }, fixture);
    expect(blocked.results.every((result) => result.includes("TOOLS_UNAVAILABLE"))).toBe(true);
    expect(blocked.draft.request.clips).toHaveLength(0);
    expect(blocked.jobs).toHaveLength(0);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    const form = page.locator(".model-settings");
    await form.getByLabel("Profile name", { exact: true }).fill("A");
    await form.getByLabel("API key", { exact: true }).fill("test-a");
    await form.getByRole("button", { name: "Save model", exact: true }).click();
    await expect(form.getByRole("status")).toContainText("Saved");
    await form.getByRole("button", { name: "Add model", exact: true }).click();
    await form.getByLabel("Profile name", { exact: true }).fill("B");
    await form.getByLabel("Model ID", { exact: true }).fill("other");
    await form.getByLabel("API key", { exact: true }).fill("test-b");
    await form.getByRole("button", { name: "Save model", exact: true }).click();
    await expect(form.getByRole("status")).toContainText("Saved");
    const profiles = await page.evaluate(() => window.videoQuickEditor.listModelProfiles());
    expect(profiles.profiles).toHaveLength(2);
    expect(profiles.selectedProfileId).toBe(profiles.profiles[0]!.id);
    await page.getByRole("button", { name: "Show chat", exact: true }).click();
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("unsent");
    await page
      .getByRole("combobox", { name: "Chat model", exact: true })
      .selectOption(profiles.profiles[1]!.id);
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("unsent");
    await page.getByRole("button", { name: "Clear chat", exact: true }).click();
    expect(
      (await page.evaluate(() => window.videoQuickEditor.listModelProfiles())).selectedProfileId,
    ).toBe(profiles.profiles[1]!.id);
    await page.getByRole("button", { name: "Hide chat", exact: true }).click();
    await page.evaluate(async () => {
      await window.videoQuickEditor.updateSettings({
        ffmpegPath: "/opt/homebrew/bin/ffmpeg",
        ffprobePath: "/opt/homebrew/bin/ffprobe",
      });
    });
    await expect(page.getByRole("status", { name: "Media dependencies" })).toHaveCount(0);
    await page.getByRole("link", { name: "Edit", exact: true }).click();
    await page.getByRole("button", { name: "Show chat", exact: true }).click();
    await page.getByRole("textbox", { name: "Message", exact: true }).fill(fixture);
    await page.getByRole("button", { name: "Import paths", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.videoQuickEditor.getDraft())).request.clips.length,
      )
      .toBe(1);
    const output = info.outputPath("export.mp4");
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, output);
    const job = await page.evaluate(async () => {
      const draft = await window.videoQuickEditor.getDraft();
      draft.request.clips[0]!.startUs = 500000;
      draft.request.clips[0]!.endUs = 1000000;
      draft.request.clips[0]!.watermark = {
        ...draft.request.watermark,
        enabled: true,
        text: "Hello",
      };
      draft.request.clips.push({
        ...draft.request.clips[0]!,
        id: "00000000-0000-4000-8000-000000000003",
        startUs: 1000000,
        endUs: 1500000,
      });
      draft.request.mode = "normalize";
      draft.request.output = await window.videoQuickEditor.chooseOutput("export.mp4");
      const next = await window.videoQuickEditor.updateDraft({
        expectedRevision: draft.revision,
        selectedClipId: draft.selectedClipId,
        request: draft.request,
      });
      await window.videoQuickEditor.planExport(next.request);
      return await window.videoQuickEditor.startExport(next.request);
    });
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.videoQuickEditor.getJobs())).find(
            (j) => j.id === job.id,
          )?.state,
        { timeout: 20000 },
      )
      .toBe("completed");
    const probe = JSON.parse(
      execFileSync(
        "/opt/homebrew/bin/ffprobe",
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", output],
        { encoding: "utf8" },
      ),
    );
    expect(probe.streams[0].codec_name).toBe("h264");
    expect(Number(probe.format.duration)).toBeCloseTo(1, 1);
    execFileSync(
      "/opt/homebrew/bin/ffmpeg",
      ["-nostdin", "-v", "error", "-i", output, "-f", "null", "-"],
      { stdio: "ignore" },
    );
    await page.evaluate(async (path) => {
      await window.videoQuickEditor.updateSettings({ ffmpegPath: path });
    }, absent);
    await expect(page.getByRole("status", { name: "Media dependencies" })).toContainText(
      "Not found",
    );
    const errors = await page.evaluate(async () => {
      const draft = await window.videoQuickEditor.getDraft();
      const assetId = draft.request.clips[0]!.assetId;
      const failures = [];
      for (const operation of [
        () => window.videoQuickEditor.planExport(draft.request),
        () => window.videoQuickEditor.startExport(draft.request),
        () => window.videoQuickEditor.createProxy(assetId),
        () =>
          window.videoQuickEditor.previewFrame({
            assetId,
            atUs: 500000,
            watermark: draft.request.watermark,
          }),
      ]) {
        try {
          await operation();
          failures.push("unexpected success");
        } catch (error) {
          failures.push(String(error));
        }
      }
      return failures;
    });
    expect(errors.every((error) => error.includes("TOOLS_UNAVAILABLE"))).toBe(true);
    expect(await page.evaluate(() => window.videoQuickEditor.getJobs())).toHaveLength(1);
    expect(await readFile(output)).toBeTruthy();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByLabel("Language", { exact: true }).selectOption("zh-CN");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(820, 760));
    await expect(page.getByRole("status", { name: "媒体依赖" })).toContainText("未找到");
    await page.screenshot({ path: info.outputPath("dependency-models.png") });
    await app.close();
    app = await electron.launch({ executablePath, args: [`--user-data-dir=${data}`] });
    await patch();
    const restarted = await app.firstWindow();
    expect(
      (await restarted.evaluate(() => window.videoQuickEditor.listModelProfiles()))
        .selectedProfileId,
    ).toBe(profiles.profiles[1]!.id);
  } finally {
    await app.close();
  }
});

test("chat selector changes next turn while reserved import and SDK loop stay on the original profile", async ({
  browserName,
}, info) => {
  void browserName;
  test.setTimeout(60000);
  let release: (() => void) | undefined;
  const requests: { url: string; key: string }[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body);
    requests.push({ url: req.url ?? "", key: req.headers.authorization ?? "" });
    const tool = parsed.messages.some((m: { role: string }) => m.role === "tool");
    if (tool && requests.length === 2)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    const delta = tool
      ? { content: "Reply complete" }
      : {
          tool_calls: [
            {
              index: 0,
              id: `tool-${requests.length}`,
              type: "function",
              function: { name: "get_editor_context", arguments: "{}" },
            },
          ],
        };
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const chunk of [
      { choices: [{ index: 0, delta, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: tool ? "stop" : "tool_calls" }] },
    ])
      res.write(`data: ${JSON.stringify({ id: "mock", created: 1, model: "mock", ...chunk })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error();
  const app = await electron.launch({
    executablePath: resolve(
      "release/mac-arm64/Video Quick Editor.app/Contents/MacOS/Video Quick Editor",
    ),
    args: [`--user-data-dir=${info.outputPath("models")}`],
  });
  try {
    await app.evaluate(({ safeStorage }) => {
      safeStorage.isEncryptionAvailable = () => true;
      safeStorage.encryptString = (s) => Buffer.from(s).reverse();
      safeStorage.decryptString = (b) => Buffer.from(b).reverse().toString();
    });
    const page = await app.firstWindow();
    const profiles = await page.evaluate(async (base) => {
      let state = await window.videoQuickEditor.listModelProfiles();
      state = await window.videoQuickEditor.saveModelProfile({
        expectedRevision: state.revision,
        name: "A",
        baseURL: `${base}/a`,
        modelId: "mock-a",
        apiKey: "key-a",
      });
      return await window.videoQuickEditor.saveModelProfile({
        expectedRevision: state.revision,
        name: "B",
        baseURL: `${base}/b`,
        modelId: "mock-b",
        apiKey: "key-b",
      });
    }, `http://127.0.0.1:${address.port}`);
    const fixture = info.outputPath("import.mp4");
    execFileSync(
      "/opt/homebrew/bin/ffmpeg",
      [
        "-nostdin",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=s=160x120:r=25:d=1",
        "-c:v",
        "libx264",
        fixture,
      ],
      { stdio: "ignore" },
    );
    const slowProbe = info.outputPath("slow-ffprobe");
    await writeFile(
      slowProbe,
      '#!/bin/sh\nif [ "$1" != "-version" ]; then /bin/sleep 3; fi\nexec /opt/homebrew/bin/ffprobe "$@"\n',
      { mode: 0o700 },
    );
    await page.evaluate(async (path) => {
      await window.videoQuickEditor.updateSettings({
        ffmpegPath: "/opt/homebrew/bin/ffmpeg",
        ffprobePath: path,
      });
    }, slowProbe);
    await page.getByRole("button", { name: "Show chat", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill(`Import "${fixture}", then read the current editor context; do not export`);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator(".chat-model-selection")).toContainText("This turn: A");
    expect(requests).toHaveLength(0);
    expect(
      (await page.evaluate(() => window.videoQuickEditor.getDraft())).request.clips,
    ).toHaveLength(0);
    await page
      .getByRole("combobox", { name: "Chat model", exact: true })
      .selectOption(profiles.profiles[1]!.id);
    await expect.poll(() => requests.length).toBe(2);
    await expect(page.locator(".chat-model-selection")).toContainText("This turn: A");
    await expect(page.locator(".chat-model-selection")).toContainText("Next turn: B");
    await page.evaluate(async (id) => {
      const state = await window.videoQuickEditor.listModelProfiles();
      await window.videoQuickEditor.deleteModelProfile({ id, expectedRevision: state.revision });
    }, profiles.profiles[0]!.id);
    release?.();
    await expect
      .poll(
        async () => (await page.evaluate(() => window.videoQuickEditor.getAgentSession())).running,
      )
      .toBe(false);
    expect(
      (await page.evaluate(() => window.videoQuickEditor.getDraft())).request.clips,
    ).toHaveLength(1);
    expect(requests.slice(0, 2)).toEqual([
      { url: "/a/chat/completions", key: "Bearer key-a" },
      { url: "/a/chat/completions", key: "Bearer key-a" },
    ]);
    await expect(page.locator(".chat-message.assistant").last()).toContainText("A · mock-a");
    await page.getByRole("textbox", { name: "Message", exact: true }).fill("Say done");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect.poll(() => requests.length).toBeGreaterThan(2);
    expect(requests.at(-1)?.url).toBe("/b/chat/completions");
    expect(requests.at(-1)?.key).toBe("Bearer key-b");
  } finally {
    release?.();
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("running exports keep their tools while queued exports recheck changed dependencies", async ({
  browserName,
}, info) => {
  void browserName;
  test.setTimeout(60000);
  await mkdir(info.outputPath(), { recursive: true });
  const fixture = info.outputPath("queue-fixture.mp4");
  execFileSync(
    "/opt/homebrew/bin/ffmpeg",
    ["-nostdin", "-y", "-f", "lavfi", "-i", "color=s=160x120:r=25:d=1", "-c:v", "libx264", fixture],
    { stdio: "ignore" },
  );
  const wrapper = info.outputPath("slow-ffmpeg");
  await writeFile(
    wrapper,
    '#!/bin/sh\ncase "$*" in *-progress*) /bin/sleep 3;; esac\nexec /opt/homebrew/bin/ffmpeg "$@"\n',
    { mode: 0o700 },
  );
  const app = await electron.launch({
    executablePath: resolve(
      "release/mac-arm64/Video Quick Editor.app/Contents/MacOS/Video Quick Editor",
    ),
    args: [`--user-data-dir=${info.outputPath("queue-settings")}`],
  });
  try {
    const page = await app.firstWindow();
    await page.evaluate(
      async ({ fixture, wrapper }) => {
        await window.videoQuickEditor.updateSettings({
          ffmpegPath: wrapper,
          ffprobePath: "/opt/homebrew/bin/ffprobe",
        });
        const assets = await window.videoQuickEditor.importLocalPaths([fixture]);
        const draft = await window.videoQuickEditor.getDraft();
        await window.videoQuickEditor.updateDraft({
          expectedRevision: draft.revision,
          selectedClipId: null,
          request: {
            ...draft.request,
            clips: [
              {
                id: "00000000-0000-4000-8000-000000000004",
                assetId: assets[0]!.id,
                startUs: 0,
                endUs: 1000000,
              },
            ],
          },
        });
      },
      { fixture, wrapper },
    );
    const output = info.outputPath("running.mp4");
    const queuedOutput = info.outputPath("queued.mp4");
    const start = async (path: string) => {
      await app.evaluate(({ dialog }, path) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
      }, path);
      return await page.evaluate(async () => {
        const request = (await window.videoQuickEditor.getDraft()).request;
        request.output = await window.videoQuickEditor.chooseOutput("test.mp4");
        return await window.videoQuickEditor.startExport(request);
      });
    };
    const running = await start(output);
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.videoQuickEditor.getJobs())).find(
            (j) => j.id === running.id,
          )?.state,
      )
      .toBe("running");
    const queued = await start(queuedOutput);
    await page.evaluate(async (path) => {
      await window.videoQuickEditor.updateSettings({ ffmpegPath: path });
    }, info.outputPath("missing-tool"));
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.videoQuickEditor.getJobs())).find(
            (j) => j.id === running.id,
          )?.state,
        { timeout: 20000 },
      )
      .toBe("completed");
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.videoQuickEditor.getJobs())).find(
            (j) => j.id === queued.id,
          )?.state,
      )
      .toBe("failed");
    const failed = (await page.evaluate(() => window.videoQuickEditor.getJobs())).find(
      (j) => j.id === queued.id,
    );
    expect(failed?.error).toContain("TOOLS_UNAVAILABLE");
    expect(await readFile(fixture)).toBeTruthy();
    expect(await readFile(output)).toBeTruthy();
    await expect(readFile(queuedOutput)).rejects.toThrow();
  } finally {
    await app.close();
  }
});
