import { z } from "zod";
import { appUpdateSchema, type AppUpdate } from "@video-quick-editor/shared";

const repository = "GrahamQuan/video-quick-editor";
const apiRoot = `https://api.github.com/repos/${repository}`;
const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/;
function versionParts(version: string) {
  const match = versionPattern.exec(version);
  if (!match) throw new Error("invalid-response");
  const pre = match[4]?.split(".") ?? [];
  if (pre.some((part) => /^0\d+$/.test(part))) throw new Error("invalid-response");
  return { core: match.slice(1, 4).map(BigInt), pre };
}
export function compareVersions(a: string, b: string): number {
  const left = versionParts(a),
    right = versionParts(b);
  for (let i = 0; i < 3; i++) {
    if (left.core[i] !== right.core[i]) return left.core[i]! > right.core[i]! ? 1 : -1;
  }
  if (!left.pre.length || !right.pre.length)
    return left.pre.length === right.pre.length ? 0 : left.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i],
      y = right.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x),
      yn = /^\d+$/.test(y);
    if (xn && yn) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (xn !== yn) return xn ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}
const releaseSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.string().datetime().nullable().optional(),
  assets: z.array(z.object({ name: z.string(), state: z.string(), size: z.number() })),
});
function compareReleaseVersions(a: string, b: string, releases: z.infer<typeof releaseSchema>[]) {
  const left = versionParts(a),
    right = versionParts(b);
  // main builds reuse the stable base version. Across stable/main channels only,
  // publication order prevents offering an older stable binary as an upgrade.
  if (
    left.core.every((part, i) => part === right.core[i]) &&
    ((left.pre[0] === "main" && !right.pre.length) || (!left.pre.length && right.pre[0] === "main"))
  ) {
    const date = (version: string) =>
      releases.find((release) => !release.draft && release.tag_name === `v${version}`)
        ?.published_at;
    const ad = date(a),
      bd = date(b);
    if (ad && bd && ad !== bd) return Date.parse(ad) > Date.parse(bd) ? 1 : -1;
  }
  return compareVersions(a, b);
}
export function newestRelease(raw: unknown[], includePrereleases: boolean) {
  const releases = raw.map((entry) => releaseSchema.parse(entry));
  const candidates: { version: string; url: string }[] = [];
  const mainBuilds = new Map<string, { version: string; url: string }>();
  let latest: { version: string; url: string } | null = null;
  for (const release of releases) {
    if (release.draft || (!includePrereleases && release.prerelease)) continue;
    if (!release.tag_name.startsWith("v")) continue;
    const version = release.tag_name.slice(1);
    if (!versionPattern.test(version)) continue;
    const parts = versionParts(version);
    if (!includePrereleases && parts.pre.length) continue;
    const filename = `Video-Quick-Editor-${version}-mac-arm64.dmg`;
    if (
      !release.assets.some(
        (asset) => asset.name === filename && asset.state === "uploaded" && asset.size > 0,
      )
    )
      continue;
    const candidate = {
      version,
      url: `https://github.com/${repository}/releases/tag/${encodeURIComponent(release.tag_name)}`,
    };
    if (parts.pre[0] === "main") {
      // A slower older workflow can publish after a newer one. Pick the highest
      // main run first, then compare that run with its stable release.
      const base = parts.core.join(".");
      const previous = mainBuilds.get(base);
      if (!previous || compareVersions(version, previous.version) > 0)
        mainBuilds.set(base, candidate);
    } else candidates.push(candidate);
  }
  for (const candidate of [...candidates, ...mainBuilds.values()])
    if (!latest || compareReleaseVersions(candidate.version, latest.version, releases) > 0)
      latest = candidate;
  return latest;
}

export class AppUpdates {
  private state: AppUpdate;
  private releaseUrl: string | null = null;
  private pending: Promise<AppUpdate> | null = null;
  private downloading: Promise<AppUpdate> | null = null;
  constructor(
    currentVersion: string,
    private emit: (state: AppUpdate) => void,
    private request: typeof fetch = fetch,
    private installer?: (version: string, progress: (fraction: number) => void) => Promise<void>,
  ) {
    this.state = {
      currentVersion,
      includePrereleases: versionParts(currentVersion).pre.length > 0,
      status: "idle",
      latestVersion: null,
      checkedAt: null,
      downloadProgress: null,
      error: null,
    };
  }
  snapshot(): AppUpdate {
    return appUpdateSchema.parse(this.state);
  }
  private publish() {
    this.emit(this.snapshot());
  }
  check(includePrereleases: boolean): Promise<AppUpdate> {
    if (this.downloading) return this.downloading;
    if (this.pending) return this.pending;
    this.pending = this.inspect(includePrereleases).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  private async inspect(includePrereleases: boolean): Promise<AppUpdate> {
    this.releaseUrl = null;
    this.state = {
      ...this.state,
      includePrereleases,
      status: "checking",
      downloadProgress: null,
      latestVersion: null,
      error: null,
    };
    this.publish();
    try {
      const signal = AbortSignal.timeout(20_000);
      const releases: unknown[] = [];
      // Read all pages within a bounded request budget, rather than assuming date order
      // is semantic version order. Do not report "current" for an incomplete listing.
      for (let page = 1; ; page++) {
        if (page > 10) throw new Error("invalid-response");
        const response = await this.request(`${apiRoot}/releases?per_page=100&page=${page}`, {
          signal,
          redirect: "error",
          headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
        });
        if (response.status === 403 || response.status === 429) throw new Error("rate-limit");
        if (!response.ok) throw new Error("network");
        const data = z.array(z.unknown()).parse(await response.json());
        releases.push(...data);
        if (data.length < 100) break;
      }
      const latest = newestRelease(releases, includePrereleases);
      if (!latest) throw new Error("invalid-response");
      const available =
        compareReleaseVersions(
          latest.version,
          this.state.currentVersion,
          releases.map((entry) => releaseSchema.parse(entry)),
        ) > 0;
      this.releaseUrl = available ? latest.url : null;
      this.state = {
        ...this.state,
        status: available ? "available" : "current",
        latestVersion: latest.version,
        checkedAt: new Date().toISOString(),
        error: null,
      };
    } catch (error) {
      const code =
        error instanceof z.ZodError
          ? "invalid-response"
          : error instanceof Error &&
              (error.message === "rate-limit" || error.message === "invalid-response")
            ? error.message
            : "network";
      this.state = { ...this.state, status: "error", error: code };
    }
    this.publish();
    return this.snapshot();
  }
  download(): Promise<AppUpdate> {
    if (this.downloading) return this.downloading;
    if (this.state.status !== "available" || !this.state.latestVersion || !this.installer)
      return Promise.reject(new Error("No verified update available"));
    const version = this.state.latestVersion;
    this.state = { ...this.state, status: "downloading", downloadProgress: 0, error: null };
    this.publish();
    this.downloading = Promise.resolve()
      .then(() =>
        this.installer!(version, (fraction) => {
          this.state = { ...this.state, downloadProgress: fraction };
          this.publish();
        }),
      )
      .then(() => {
        this.state = { ...this.state, status: "available", downloadProgress: 1 };
      })
      .catch(() => {
        this.state = {
          ...this.state,
          status: "available",
          downloadProgress: null,
          error: "download-failed",
        };
      })
      .then(() => {
        this.publish();
        return this.snapshot();
      })
      .finally(() => {
        this.downloading = null;
      });
    return this.downloading;
  }
  async open(openExternal: (url: string) => Promise<void>): Promise<void> {
    if (this.state.status !== "available" || !this.releaseUrl)
      throw new Error("No verified update available");
    await openExternal(this.releaseUrl);
  }
}
