# Video Quick Editor Desktop

[English](README.md) | **简体中文**

面向 macOS 的本地视频剪辑、组合与文字水印工具。项目是独立的 **Turborepo + pnpm workspace**，桌面端使用 Electron、React、TypeScript、TanStack Router 和 Vite；媒体处理由 Electron main process 直接调用本机 FFmpeg/ffprobe，不依赖 Python、WASM、HTTP 服务或旧版应用。

## 底层工具链

- Vite 8 使用 Rust 编写的 Rolldown 构建 renderer、main、preload 和 workspace libraries。
- TypeScript 7 负责 strict type checking（严格类型检查）与 declaration emit（类型声明生成）。
- Oxlint + `oxlint-tsgolint` 执行 type-aware lint（类型感知检查），不使用 ESLint。
- Oxfmt 负责全仓库格式化，不使用 Prettier。
- React Compiler 通过 `@vitejs/plugin-react` 的 Oxc Rust backend 启用。
- Tailwind CSS 4 通过官方 `@tailwindcss/vite` plugin 直接接入 Vite，不经过旧式 PostCSS 配置。
- 主预览播放器使用 `@videojs/react` 的 `VideoPlayer`、`VideoSkin` 与 `Video` preset，控件语言跟随应用设置。
- 所有 package 都声明 `"type": "module"`，源码、配置和 ESM 产物统一使用普通 `.js` 后缀，不使用 `.mjs`。唯一语义例外是 Electron sandbox preload：它仍由 bundler 输出为 CommonJS，但文件名保持 `index.js`，这是 Electron sandbox 的运行要求。

界面配色集中定义在 renderer/styles.css：`--color-primary` 为绿色主色，`--color-secondary` 为主色 16% 透明度，用于选区及次要控件；边框、悬停和焦点态由同一主色派生。

## 仓库结构

```text
apps/video-quick-editor-desktop/   Electron main / preload / React renderer
packages/shared/            IPC schemas、共享类型（Zod runtime validation）
packages/media-core/        probe、计划、FFmpeg runner、验证与输出保护
```

建议先读 `packages/shared/src/index.ts`，再读 `packages/media-core/src/planner.ts` 与 `runner.ts`，最后看 `apps/video-quick-editor-desktop/src/main/index.ts` 的 IPC 边界和 renderer。

## 环境准备

- macOS（当前 package 脚本生成当前 arm64 架构的未签名 `.app`）
- Node.js 22.12+ 与 pnpm 10.33+
- 本机安装 FFmpeg/ffprobe，并包含 `libx264`、`libx265`、`aac` encoder 和 `drawtext`、`concat`、`scale`、`pad`、`fps` filters

应用会检测 `/opt/homebrew/bin`、`/usr/local/bin`、`/usr/bin`；Finder 启动不依赖终端 PATH。也可在“设置”页用原生文件选择器指定 executable。应用不会自动安装或下载 FFmpeg。

界面默认使用英语，可在 Settings 中切换 English / 简体中文。选择会写入 Electron `userData/settings.json`，之后启动继续使用该语言；旧版设置自动迁移为英语。

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
3. 可选统一的白字黑描边文字水印。默认自动选择经过检查的 macOS 系统字体；预览与导出时继续验证实际文字的全部字形，也可手动更换字体。
4. 单段默认 `accurate`，多段默认 `normalize`；主动选择的 `copy` 不会被静默改回。
5. 选择输出或使用 macOS Downloads。默认名使用本地时间 `YYYY_MM_DD--HH_mm_ss`（24 小时制，将 `YYYY/MM/DD hh:mm:ss` 中的 日期和时间内部使用下划线 `_`，两者之间使用 `--`），重名自动加 `_2`、`_3`。
6. 在“导出”页查看 main process 权威状态和一位小数进度；可中断任务并自动删除半成品，也可勾选多个已结束任务批量清理队列记录（不会删除导出视频）。

当前选中片段的播放预览仅播放该片段的起止区间：到终点暂停，再次播放从起点开始。修改范围后，若播放位置在新区间外则回到起点。预览时间边界为近似效果，最终导出边界由 FFmpeg 处理。

水印描边默认厚度为 1 个输出像素，可自定义为 0–20 像素；0 表示关闭黑色描边。设置同时用于叠加预览、FFmpeg 单帧预览和导出。

水印仅作用于当前选中的片段：开关、文字、字体、描边、位置、字号和边距独立保存。切换片段会恢复各自设置，拼接导出也仅在对应片段中绘制水印。复制片段会复制其设置，之后可分别修改。

水印默认字体：启动时保留可读的已选字体，否则检查 macOS 系统的苹方 / 黑体，验证中英文示例字形后自动选用。无需安装或下载字体；界面显示实际字体文件名，仍可手动更换。预览和导出继续检查实际文字的全部字形及是否超出画面；系统字体均不可用时才需要手动选择。

裁剪时间尺显示时间刻度而非音轨波形。拖动左右手柄分别设置 start/end，时间输入框双向同步；支持方向键微调 0.1 秒、Shift 加方向键调整 1 秒。

## 格式合同与限制

- `accurate`：单片段、重编码、可加水印。默认将 h264/hevc 映射到 libx264/libx265；source profile 的音频只接受 AAC，compatible profile 可转换非 AAC 音频。
- `normalize`：每段 trim 后统一尺寸、SAR、fps；等比缩放并补黑边；有音频时统一 AAC 48 kHz stereo 192 kb/s，缺失或过短部分补静音。
- `copy`：不重编码，水印与编码设置不可用；剪辑边界受关键帧/packet 影响，多段会先生成受控临时片段再 concat。
- 新草稿默认 `mp4-compatible`：真实 MP4 / faststart、H.264/libx264、medium、CRF 18、8-bit yuv420p；有音频时编码为 AAC 48 kHz 双声道 192 kb/s。MOV/MKV 也输出 `.mp4`。
- `source` 保留旧容器和编码规则。旧 IPC 缺少 outputProfile 仍按 source 解析；copy/HEVC 需显式选择 source，不会静默改变模式。
- compatible accurate 支持非 AAC 音频；奇数显示尺寸补齐偶数。normalize 对 VFR 或未知帧率采用 30 fps，并在计划中说明。
- 重编码只支持普通 SDR、8-bit、无旋转 metadata。HDR、10-bit、旋转输入会被明确阻止；`copy` 不改这些属性。
- 只使用第一条普通视频和第一条音频；额外轨道、字幕、附件、章节不保留。

播放器只用于定位，不证明逐帧精度。Chromium 无法播放而 FFmpeg 可处理时，可生成缓存中的 720p H.264/AAC proxy；proxy 由源文件 path/size/mtime 与设置形成 cache key，最终导出仍读取原文件。React 水印 overlay 是近似预览，“预览导出画面”才使用实际 FFmpeg drawtext filter。

默认输出目录来自 Electron `app.getPath('downloads')`，不会硬编码用户名。真实导出才创建缺失目录；输出先写在目标目录的临时目录，ffprobe 验证后再排他发布。未经 Save dialog 替换授权不覆盖文件，且输入文件、symlink/hard-link 别名都不能成为输出。

## Agent 剪辑

点击右上角侧栏按钮，在 Settings / 设置的 Model / 模型区域填写 OpenAI-compatible Chat Completions 根地址、Model ID 和 API key 后保存。DeepSeek 预设建议 `deepseek-v4-flash`，模型 ID 可自由修改。测试连接验证文本、流式响应和无副作用工具循环；保存本身不表示连接验证成功。

例如：“A 保留 5–20 秒，B 保留前 10 秒，拼接，加‘旅行记录’水印并导出。”如默认字体缺少所用字形，可通过字体选择器更换。仅修改或预览不会请求导出。“停止回复”停止 Agent 后续调用；已提交的导出需在导出页单独取消。

主进程维护带 revision 的共享草稿。手动编辑与 Agent 同步，旧版本写入和计划被拒绝，已提交任务使用快照；同一 requestId 重试不重复导出。多个导出按队列串行执行。隐藏侧栏和页面导航保留聊天、输入草稿与运行任务；窄窗口使用覆盖面板。

在线模型仅接收指令、显示文件名和媒体参数，不上传视频、音频或预览图。API key 经 Electron safeStorage（macOS Keychain）加密后放在独立凭证文件，普通模型配置只保留引用，读取设置的 IPC 不返回密钥。更换端点需明确输入新 key；远程仅 HTTPS，拒绝请求重定向，无明文降级。设置变更下一轮生效。上下文按完整工具轮次裁剪，保留历史用户约束；预算不足会提示，不静默丢弃约束。DeepSeek 推理模式暂关闭，待单独验证。

真实 DeepSeek 文本、流式和多步工具验收需要用户配置 key，离线测试不代表在线模型已经通过验收。

Agent 聊天按执行顺序展示回复，工具结果默认折叠，可展开查看。工具结果自动交回模型继续执行；模型输出达到长度限制或未给出最终回复时会明确提示。

助手回复使用 Streamdown 渲染流式 Markdown，支持中文强调、列表、表格和可复制代码块；工具详情保留为可折叠的结构化数据。聊天自动跟随新回复，向上翻阅时暂停跟随。模型生成的链接显示为文本，不加载远程图片。

点击 **清空聊天**，一键清除全部消息、未发送文本和模型对话上下文。正在进行的回复会先停止再清空；剪辑草稿、模型设置和导出任务保留。

### 从本地路径开始

在聊天输入框粘贴文件或文件夹绝对路径（每行一条），点击 **导入路径**，无需 API key，路径不会发送给模型。支持引号包裹路径、`~/` 和本地 `file://` URL。文件夹按文件名自然顺序导入第一层 MP4/MOV/MKV，跳过隐藏文件、子目录和目录中的符号链接；每次最多 100 个视频。

也可以直接发送：`导入 "/路径/视频.mp4"，然后保留 2 到 5 秒，不要导出`（同样支持文件夹）。应用先在本机导入并等待时间线更新，将路径替换为导入素材引用，再交给已配置的模型继续剪辑。带空格的路径请加引号或反引号。若后续路径导入失败，已导入素材保留，不发送模型请求。

支持无需“导入”前缀的编号剪辑指令，例如“视频剪辑和拼接：1. 路径A，1到3秒；2. 路径B，5到10秒；然后拼接”。路径支持英文引号、反引号，以及正向或反向的弯引号。每条路径与对应时间范围按原序保留。

```text
视频剪辑和拼接
1. "/Users/you/Movies/a.mp4"，保留第 1 秒到第 3 秒
2. "/Users/you/Movies/b.mp4"，保留第 5 秒到第 10 秒
剪辑完成后拼接，最后输出视频
```

## 安全边界

Renderer 开启 `contextIsolation` 与 sandbox，关闭 `nodeIntegration`。preload 只暴露 typed API，不暴露 `ipcRenderer`；main 对 IPC sender、payload、素材 ID、字体 ID、输出 token 和文件身份重新校验。媒体 URL 只映射当前会话已导入或生成的文件。FFmpeg 始终用 `spawn(executable, args, { shell: false })` 和 `-nostdin`。

## 测试说明

Vitest 覆盖共享契约、输出 profile、水印字形、路径识别、revision、任务幂等性和模型配置。媒体集成测试用临时 lavfi 视频验证真实 FFmpeg 输出；缺少所需 FFmpeg 时会跳过并报告原因。Playwright 在临时 userData 下启动打包后的 Electron 应用，验证双语设置、裁剪播放、路径导入、Agent 多步工具循环、Markdown 和清空聊天。测试不会使用私人视频；模型测试使用模拟端点，不能代替真实供应商验收。

未包含签名、公证、自动更新、跨平台安装包、专业多轨时间线、转场、字幕、图片水印、网络素材、项目持久化或崩溃恢复。
