const { rm } = require("node:fs/promises");
const { promisify } = require("node:util");
const { execFile } = require("node:child_process");
const { join } = require("node:path");
module.exports = async ({ appOutDir, packager }) => {
  // Custom electronDist carries the development launcher; packaged apps must load app.asar.
  await rm(
    join(
      appOutDir,
      `${packager.appInfo.productFilename}.app`,
      "Contents",
      "Resources",
      "default_app.asar",
    ),
    { force: true },
  );
  // The custom Electron bundle has changed. Repair its local signature before
  // DMG creation; electron-builder can still apply a Developer ID afterward.
  if (process.platform === "darwin")
    await promisify(execFile)(process.execPath, [
      join(__dirname, "ensure-electron-signature.js"),
      join(appOutDir, `${packager.appInfo.productFilename}.app`),
    ]);
};
