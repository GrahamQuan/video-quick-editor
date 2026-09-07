# Video Quick Editor Desktop

面向 macOS 的本地视频剪辑、组合与文字水印工具。项目是独立的 **Turborepo + pnpm workspace**，桌面端使用 Electron、React、TypeScript、TanStack Router 和 Vite；媒体处理由 Electron main process 直接调用本机 FFmpeg/ffprobe，不依赖 Python、WASM、HTTP 服务或旧版应用。

## 底层工具链

- Vite 8 使用 Rust 编写的 Rolldown 构建 renderer、main、preload 和 workspace libraries。
- TypeScript 7 负责 strict type checking（严格类型检查）与 declaration emit（类型声明生成）。
- Oxlint + `oxlint-tsgolint` 执行 type-aware lint（类型感知检查），不使用 ESLint。
- Oxfmt 负责全仓库格式化，不使用 Prettier。
- React Compiler 通过 `@vitejs/plugin-react` 的 Oxc Rust backend 启用。
- 所有 package 都声明 `"type": "module"`，源码、配置和 ESM 产物统一使用普通 `.js` 后缀，不使用 `.mjs`。唯一语义例外是 Electron sandbox preload：它仍由 bundler 输出为 CommonJS，但文件名保持 `index.js`，这是 Electron sandbox 的运行要求。

## 仓库结构

```text
apps/video-quick-editor-desktop/   Electron main / preload / React renderer
packages/shared/            IPC schemas、共享类型（Zod runtime validation）
packages/media-core/        probe、计划、FFmpeg runner、验证与输出保护
```

建议先读 `packages/shared/src/index.ts`，再读 `packages/media-core/src/planner.ts` 与 `runner.ts`，最后看 `apps/video-quick-editor-desktop/src/main/index.ts` 的 IPC 边界和 renderer。

## 环境准备

- macOS（当前 package 脚本生成当前 arm64 架构的未签名 `.app`）
- Node.js 20.19+ 与 pnpm 10.33+
- 本机安装 FFmpeg/ffprobe，并包含 `libx264`、`libx265`、`aac` encoder 和 `drawtext`、`concat`、`scale`、`pad`、`fps` filters

应用会检测 `/opt/homebrew/bin`、`/usr/local/bin`、`/usr/bin`；Finder 启动不依赖终端 PATH。也可在“设置”页用原生文件选择器指定 executable。应用不会自动安装或下载 FFmpeg。

```bash
pnpm install
pnpm dev
pnpm build
pnpm format
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm package
```

`pnpm package` 生成 `apps/video-quick-editor-desktop/release/mac-arm64/Video Quick Editor.app`（未签名、未公证、仅当前架构）。

`pnpm dev` 会先验证开发依赖中的 `Electron.app`。如果 pnpm cache 中的 bundle seal 损坏，脚本只在 macOS 上为该开发依赖重新生成本机 ad-hoc signature，然后再启动 Vite；有效签名不会被重复修改。

## 操作流程

1. 添加或拖入 MP4、MOV、MKV；一个片段进入裁剪工作流，两个以上片段进入组合时间线，接收顺序就是播放顺序。
2. 选择片段并设置 `[start, end)`。组合时可继续添加、复制并拖动片段，界面会明确显示从上到下的输出顺序。
3. 可选统一的白字黑描边文字水印。首次使用必须选择可读字体；中文字体必须真的包含中文字形。
4. 单段默认 `accurate`，多段默认 `normalize`；主动选择的 `copy` 不会被静默改回。
5. 选择输出或使用 macOS Downloads。默认名为 `<stem>_clip` / `<first_stem>_combined`，重名自动加 `_2`、`_3`。
6. 在“导出”页查看 main process 权威状态和一位小数进度；可中断任务并自动删除半成品，也可勾选多个已结束任务批量清理队列记录（不会删除导出视频）。

## 格式合同与限制

- `accurate`：单片段、重编码、可加水印。默认将 h264/hevc 映射到 libx264/libx265；音频第一期只接受 AAC。
- `normalize`：每段 trim 后统一尺寸、SAR、fps；等比缩放并补黑边；有音频时统一 AAC 48 kHz stereo 192 kb/s，缺失或过短部分补静音。
- `copy`：不重编码，水印与编码设置不可用；剪辑边界受关键帧/packet 影响，多段会先生成受控临时片段再 concat。
- 第一版只接受 MP4、MOV、MKV，输出容器继承首段，不能靠修改扩展名改变容器。
- 重编码只支持普通 SDR、8-bit、无旋转 metadata。HDR、10-bit、旋转输入会被明确阻止；`copy` 不改这些属性。
- 只使用第一条普通视频和第一条音频；额外轨道、字幕、附件、章节不保留。

播放器只用于定位，不证明逐帧精度。Chromium 无法播放而 FFmpeg 可处理时，可生成缓存中的 720p H.264/AAC proxy；proxy 由源文件 path/size/mtime 与设置形成 cache key，最终导出仍读取原文件。React 水印 overlay 是近似预览，“预览导出画面”才使用实际 FFmpeg drawtext filter。

默认输出目录来自 Electron `app.getPath('downloads')`，不会硬编码用户名。真实导出才创建缺失目录；输出先写在目标目录的临时目录，ffprobe 验证后再排他发布。未经 Save dialog 替换授权不覆盖文件，且输入文件、symlink/hard-link 别名都不能成为输出。

## 安全边界

Renderer 开启 `contextIsolation` 与 sandbox，关闭 `nodeIntegration`。preload 只暴露 typed API，不暴露 `ipcRenderer`；main 对 IPC sender、payload、素材 ID、字体 ID、输出 token 和文件身份重新校验。媒体 URL 只映射当前会话已导入或生成的文件。FFmpeg 始终用 `spawn(executable, args, { shell: false })` 和 `-nostdin`。

## 测试说明

Vitest 覆盖时间解析、非法范围、copy 差异、特殊路径、水印计划和输出保护。媒体 integration test 用 lavfi 临时生成小视频并执行真实 accurate 导出，不写入真实 Downloads，也不提交 fixture。找不到 `/opt/homebrew/bin/ffmpeg` 时该用例会注明环境原因后跳过执行体。Playwright Electron smoke test 会先生成未签名 `.app`，再检查 packaged app 启动、hash navigation、preload API 与 renderer 中不存在 Node `require`。

未包含签名、公证、自动更新、跨平台安装包、专业多轨时间线、转场、字幕、图片水印、网络素材、项目持久化或崩溃恢复。
