import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, copyFile, appendFile, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import versionAnchor from "./release-version.json" with { type: "json" };

const desktop = "apps/video-quick-editor-desktop";
export function releaseMetadata(baseVersion, runNumber, sha, anchor = versionAnchor) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(baseVersion))
    throw new Error("Desktop version must be stable x.y.z");
  if (!/^[1-9]\d*$/.test(runNumber)) throw new Error("Invalid workflow run number");
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid source commit");
  if (
    baseVersion !== anchor.baseVersion ||
    !Number.isSafeInteger(anchor.baseRunNumber) ||
    anchor.baseRunNumber < 0
  )
    throw new Error("Desktop version and release anchor must be updated together");
  const increment = BigInt(runNumber) - BigInt(anchor.baseRunNumber);
  if (increment <= 0n) throw new Error("Workflow run must follow the release anchor");
  // GitHub run numbers are unique and unchanged by retries. Mapping from the
  // last legacy run avoids races and avoids version-only commits triggering CI.
  // For a future major/minor bump, reset both the desktop version and this anchor.
  const [major, minor, patch] = baseVersion.split(".");
  const version = `${major}.${minor}.${BigInt(patch) + increment}`;
  return {
    version,
    tag: `v${version}`,
    sha,
    filename: `Video-Quick-Editor-${version}-mac-arm64.dmg`,
  };
}
function command(executable, args) {
  const result = spawnSync(executable, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${executable} failed: ${result.stderr}`);
  return result.stdout;
}
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
export function verifyAssets(assets, expected) {
  for (const file of expected) {
    const asset = assets.find((item) => item.name === file.name);
    if (
      !asset ||
      asset.state !== "uploaded" ||
      asset.size !== file.size ||
      asset.digest !== file.digest
    )
      throw new Error(`Release asset verification failed: ${file.name}`);
  }
}
function lookupJSON(endpoint) {
  const result = spawnSync("gh", ["api", endpoint], {
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status === 0) return JSON.parse(result.stdout);
  if (result.stderr.includes("HTTP 404")) return null;
  throw new Error(`Cannot inspect release: ${result.stderr}`);
}
export function lookupRelease(repository, tag, lookup = lookupJSON) {
  const published = lookup(`repos/${repository}/releases/tags/${tag}`);
  if (published) return published;
  // GitHub's by-tag endpoint excludes drafts, even for an authorized token.
  for (let page = 1; ; page++) {
    const releases = lookup(`repos/${repository}/releases?per_page=100&page=${page}`);
    if (!Array.isArray(releases)) throw new Error("Cannot list release drafts");
    const draft = releases.find((release) => release.tag_name === tag);
    if (draft) return draft;
    if (releases.length < 100) return null;
  }
}
export function lookupTag(repository, tag, lookup = lookupJSON) {
  // The commits endpoint returns 422 for an unknown ref. The exact ref endpoint
  // returns 404, distinguishing a new release from other API failures.
  if (!lookup(`repos/${repository}/git/ref/tags/${tag}`)) return null;
  // Resolve annotated tags to their source commit as well as lightweight tags.
  const commit = lookup(`repos/${repository}/commits/${tag}`);
  if (!commit?.sha) throw new Error("Cannot resolve existing release tag");
  return commit.sha;
}
export async function publishRelease(
  metadata,
  directory,
  repository,
  api = { command, lookupRelease, lookupTag },
) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Invalid repository");
  const tagSHA = api.lookupTag(repository, metadata.tag);
  if (tagSHA && tagSHA !== metadata.sha)
    throw new Error("Existing tag belongs to another source commit");
  let release = api.lookupRelease(repository, metadata.tag);
  if (release && release.target_commitish !== metadata.sha)
    throw new Error("Existing release belongs to another source commit");
  const files = [];
  for (const name of [metadata.filename, "SHA256SUMS.txt"]) {
    const bytes = await readFile(join(directory, name));
    files.push({ name, size: bytes.length, digest: digest(bytes) });
  }
  if (release && !release.draft) {
    verifyAssets(release.assets, files);
    return release.html_url; // A successful rerun never replaces public binaries.
  }
  if (!release) {
    api.command("gh", [
      "release",
      "create",
      metadata.tag,
      "--repo",
      repository,
      "--target",
      metadata.sha,
      "--title",
      `Video Quick Editor ${metadata.version}`,
      "--notes-file",
      join(directory, "release-notes.md"),
      "--draft",
      "--latest=false",
    ]);
  }
  api.command("gh", [
    "release",
    "upload",
    metadata.tag,
    ...files.map((file) => join(directory, file.name)),
    "--repo",
    repository,
    "--clobber",
  ]);
  release = api.lookupRelease(repository, metadata.tag);
  if (!release || release.target_commitish !== metadata.sha)
    throw new Error("Release changed during upload");
  verifyAssets(release.assets, files);
  if (!Number.isSafeInteger(release.id) || release.id <= 0) throw new Error("Invalid release ID");
  api.command("gh", [
    "api",
    "--method",
    "PATCH",
    `repos/${repository}/releases/${release.id}`,
    "-F",
    "draft=false",
    "-F",
    "prerelease=false",
    "-f",
    "make_latest=legacy",
  ]);
  const published = api.lookupRelease(repository, metadata.tag);
  if (
    !published ||
    published.draft ||
    published.prerelease ||
    published.target_commitish !== metadata.sha
  )
    throw new Error("Release publication could not be verified");
  verifyAssets(published.assets, files);
  return published.html_url;
}
async function prepare() {
  const path = join(desktop, "package.json");
  const pkg = JSON.parse(await readFile(path, "utf8"));
  const metadata = releaseMetadata(
    pkg.version,
    process.env.GITHUB_RUN_NUMBER,
    process.env.GITHUB_SHA,
  );
  pkg.version = metadata.version; // CI checkout only; no version commit or push-back loop.
  await writeFile(path, `${JSON.stringify(pkg, null, 2)}\n`);
  await writeFile("main-release.json", JSON.stringify(metadata));
}
async function bundle(directory) {
  const metadata = JSON.parse(await readFile("main-release.json", "utf8"));
  const app = resolve(desktop, "release/mac-arm64/Video Quick Editor.app");
  if (
    command("lipo", ["-archs", join(app, "Contents/MacOS/Video Quick Editor")]).trim() !== "arm64"
  )
    throw new Error("Expected arm64 app");
  command("codesign", ["--verify", "--deep", "--strict", app]);
  // Use the ASAR reader belonging to the pinned electron-builder dependency.
  const builderRequire = createRequire(
    await realpath(resolve(desktop, "node_modules/electron-builder/package.json")),
  );
  const { listPackage, extractFile } = createRequire(
    builderRequire.resolve("app-builder-lib/package.json"),
  )("@electron/asar");
  const archive = join(app, "Contents/Resources/app.asar");
  const forbidden = listPackage(archive).filter((path) =>
    /(?:^|\/)(?:ffmpeg|ffprobe|model\.json|settings\.json|\.env)(?:$|\/)|\.(?:credential|mp4|mov|mkv|wav|mp3)$|\/(?:fixtures|test-results|\.cache|\.turbo)(?:\/|$)/i.test(
      path,
    ),
  );
  if (forbidden.length) throw new Error(`Unexpected packaged files: ${forbidden.join(", ")}`);
  if (JSON.parse(extractFile(archive, "package.json").toString()).version !== metadata.version)
    throw new Error("Packaged version differs from release");
  await mkdir(directory, { recursive: true });
  await copyFile(join(desktop, "release", metadata.filename), join(directory, metadata.filename));
  const bytes = await readFile(join(directory, metadata.filename));
  await writeFile(
    join(directory, "SHA256SUMS.txt"),
    `${digest(bytes).slice(7)}  ${metadata.filename}\n`,
  );
  await writeFile(join(directory, "main-release.json"), JSON.stringify(metadata));
  await writeFile(
    join(directory, "release-notes.md"),
    `Automated main build / main 自动发布\n\nCommit: ${metadata.sha}\n\nDownload **${metadata.filename}** from Assets, open the DMG and drag the app into Applications.\n从 Assets 下载 DMG，打开后拖入 Applications。\n\n- macOS Apple Silicon (arm64) only; no Node.js/pnpm required.\n- FFmpeg/ffprobe are external dependencies and are not bundled or installed by the app.\n- Ad-hoc signed, not Developer ID signed or notarized. macOS may block launch or show security warnings.\n- 仅支持 Apple Silicon；FFmpeg/ffprobe 需另行安装；本机 ad-hoc 签名，未公证，macOS 可能阻止启动或显示安全提示。\n\nChecks: typecheck, lint, unit/media tests, Electron tests, package architecture/content and code-signature verification. Live model providers and downloaded-app Gatekeeper behavior are not verified.\n`,
  );
}
async function main() {
  const [operation, directory = "release-artifacts"] = process.argv.slice(2);
  if (operation === "prepare") return prepare();
  if (operation === "bundle") return bundle(directory);
  if (operation !== "publish") throw new Error("Expected prepare, bundle or publish");
  const metadata = JSON.parse(await readFile(join(directory, "main-release.json"), "utf8"));
  if (
    JSON.stringify(metadata) !==
    JSON.stringify(
      releaseMetadata(
        versionAnchor.baseVersion,
        process.env.GITHUB_RUN_NUMBER,
        process.env.GITHUB_SHA,
      ),
    )
  )
    throw new Error("Artifact metadata does not match this workflow run");
  const url = await publishRelease(metadata, directory, process.env.GITHUB_REPOSITORY);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `Release: ${url}\n`);
  console.log(url);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
