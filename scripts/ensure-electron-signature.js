import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

if (process.platform === "darwin") {
  const electronApp = resolve(
    import.meta.dirname,
    "../apps/video-quick-editor-desktop/node_modules/electron/dist/Electron.app",
  );

  if (!existsSync(electronApp)) {
    throw new Error("未找到 Electron.app，请先运行 pnpm install");
  }

  const verify = spawnSync("codesign", ["--verify", "--deep", "--strict", electronApp], {
    stdio: "ignore",
  });

  if (verify.status !== 0) {
    console.warn("Electron.app 签名无效，正在生成本机 ad-hoc signature…");
    const sign = spawnSync("codesign", ["--force", "--deep", "--sign", "-", electronApp], {
      stdio: "inherit",
    });

    if (sign.error) throw sign.error;
    if (sign.status !== 0) throw new Error(`Electron.app 签名修复失败（exit ${sign.status}）`);

    const repaired = spawnSync("codesign", ["--verify", "--deep", "--strict", electronApp], {
      stdio: "ignore",
    });
    if (repaired.status !== 0) throw new Error("Electron.app 签名修复后仍未通过验证");

    console.log("Electron.app 签名已修复。");
  }
}
