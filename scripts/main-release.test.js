import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  releaseMetadata,
  publishRelease,
  verifyAssets,
  lookupTag,
  lookupRelease,
} from "./main-release.js";

const sha = "a".repeat(40);
test("release lookup finds uploaded drafts through the paginated list API", () => {
  const draft = { tag_name: "v0.1.0-main.6", draft: true, target_commitish: sha };
  const calls = [];
  assert.equal(
    lookupRelease("owner/repo", draft.tag_name, (endpoint) => {
      calls.push(endpoint);
      if (endpoint.includes("/tags/")) return null;
      if (endpoint.endsWith("page=1"))
        return Array.from({ length: 100 }, () => ({ tag_name: "other" }));
      return [draft];
    }),
    draft,
  );
  assert.equal(calls.length, 3);
  assert.equal(
    lookupRelease("owner/repo", draft.tag_name, (endpoint) =>
      endpoint.includes("/tags/") ? null : [],
    ),
    null,
  );
  assert.throws(() => lookupRelease("owner/repo", draft.tag_name, () => null), /Cannot list/);
  assert.equal(
    lookupRelease("owner/repo", draft.tag_name, () => ({ ...draft, draft: false })).draft,
    false,
  );
});
test("tag lookup handles new tags and resolves existing tags without suppressing API failures", () => {
  const ref = "repos/owner/repo/git/ref/tags/v0.1.0-main.1";
  const commit = "repos/owner/repo/commits/v0.1.0-main.1";
  assert.equal(
    lookupTag("owner/repo", "v0.1.0-main.1", (endpoint) => {
      assert.equal(endpoint, ref);
      return null;
    }),
    null,
  );
  const calls = [];
  assert.equal(
    lookupTag("owner/repo", "v0.1.0-main.1", (endpoint) => {
      calls.push(endpoint);
      return endpoint === ref ? { object: { type: "tag" } } : { sha };
    }),
    sha,
  );
  assert.deepEqual(calls, [ref, commit]);
  assert.throws(
    () =>
      lookupTag("owner/repo", "v0.1.0-main.1", () => {
        throw new Error("HTTP 403");
      }),
    /403/,
  );
  assert.throws(
    () => lookupTag("owner/repo", "v0.1.0-main.1", (endpoint) => (endpoint === ref ? {} : null)),
    /Cannot resolve/,
  );
});
test("main versions are unique per run and stable on reruns", () => {
  assert.equal(releaseMetadata("0.1.0", "12", sha).tag, "v0.1.1");
  assert.equal(releaseMetadata("0.1.0", "13", sha).tag, "v0.1.2");
  assert.equal(releaseMetadata("0.1.0", "22", sha).tag, "v0.1.11");
  assert.deepEqual(releaseMetadata("0.1.0", "12", sha), releaseMetadata("0.1.0", "12", sha));
  assert.equal(
    releaseMetadata("1.2.9", "101", sha, { baseVersion: "1.2.9", baseRunNumber: 100 }).version,
    "1.2.10",
  );
  assert.throws(() => releaseMetadata("0.1.0", "11", sha), /anchor/);
  assert.throws(() => releaseMetadata("0.2.0", "12", sha), /anchor/);
  assert.notEqual(releaseMetadata("0.1.0", "12", sha).tag, releaseMetadata("0.1.0", "13", sha).tag);
  for (const bad of ["", "../x", "v0.1.0", "0.1.0-beta"])
    assert.throws(() => releaseMetadata(bad, "12", sha));
  assert.throws(() => releaseMetadata("0.1.0", "1\nother=value", sha));
  assert.throws(() => releaseMetadata("0.1.0", "12", "main"));
});
test("asset verification rejects missing, incomplete and mismatched uploads", () => {
  const asset = { name: "app.dmg", state: "uploaded", size: 3, digest: "sha256:abc" };
  verifyAssets([asset], [asset]);
  for (const assets of [
    [],
    [{ ...asset, state: "new" }],
    [{ ...asset, digest: "sha256:other" }],
    [{ ...asset, size: 0 }],
  ])
    assert.throws(() => verifyAssets(assets, [asset]));
});
test("publish creates a draft, verifies uploads, then publishes; reruns preserve public assets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "main-release-"));
  try {
    const metadata = releaseMetadata("0.1.0", "12", sha);
    const assets = [];
    for (const name of [metadata.filename, "SHA256SUMS.txt"]) {
      const bytes = Buffer.from(`test ${name}`);
      await writeFile(join(directory, name), bytes);
      assets.push({
        name,
        size: bytes.length,
        digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        state: "uploaded",
      });
    }
    let release = null;
    const operations = [];
    const api = {
      lookupRelease: () => release,
      lookupTag: () => null,
      command: (_cmd, args) => {
        operations.push(args[0] === "api" ? "publish" : args[1]);
        if (args[1] === "create")
          release = {
            id: 123,
            draft: true,
            target_commitish: sha,
            assets: [],
            html_url: "https://example.com/untagged-draft",
          };
        if (args[1] === "create") assert.equal(args.includes("--prerelease"), false);
        if (args[1] === "upload") release.assets = assets;
        if (args[0] === "api") {
          assert.equal(args.includes("make_latest=legacy"), true);
          assert.equal(args.includes("prerelease=false"), true);
          release = {
            ...release,
            draft: false,
            prerelease: false,
            html_url: "https://example.com/release",
          };
        }
      },
    };
    assert.equal(
      await publishRelease(metadata, directory, "owner/repo", api),
      "https://example.com/release",
    );
    assert.deepEqual(operations, ["create", "upload", "publish"]);
    operations.length = 0;
    await publishRelease(metadata, directory, "owner/repo", api);
    assert.deepEqual(operations, []);
    api.lookupTag = () => "b".repeat(40);
    await assert.rejects(publishRelease(metadata, directory, "owner/repo", api), /Existing tag/);
    api.lookupTag = () => null;
    release.target_commitish = "b".repeat(40);
    await assert.rejects(
      publishRelease(metadata, directory, "owner/repo", api),
      /another source commit/,
    );
    release.target_commitish = sha;
    release.draft = true;
    operations.length = 0;
    await publishRelease(metadata, directory, "owner/repo", api);
    assert.deepEqual(operations, ["upload", "publish"]);
    release.draft = true;
    api.command = (_cmd, args) => {
      operations.push(args[1]);
      release.assets = [];
    };
    operations.length = 0;
    await assert.rejects(
      publishRelease(metadata, directory, "owner/repo", api),
      /verification failed/,
    );
    assert.deepEqual(operations, ["upload"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("prepare changes only the disposable checkout's desktop version", async () => {
  const { mkdir, readFile } = await import("node:fs/promises");
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const directory = await mkdtemp(join(tmpdir(), "release-prepare-"));
  try {
    const desktop = join(directory, "apps/video-quick-editor-desktop");
    await mkdir(desktop, { recursive: true });
    await writeFile(
      join(desktop, "package.json"),
      JSON.stringify({ name: "desktop", version: "0.1.0" }),
    );
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./main-release.js", import.meta.url)), "prepare"],
      {
        cwd: directory,
        env: { ...process.env, GITHUB_RUN_NUMBER: "42", GITHUB_SHA: sha },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      JSON.parse(await readFile(join(desktop, "package.json"), "utf8")).version,
      "0.1.31",
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, "main-release.json"), "utf8")),
      releaseMetadata("0.1.0", "42", sha),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
