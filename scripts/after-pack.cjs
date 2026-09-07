const { rm } = require("node:fs/promises");
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
};
