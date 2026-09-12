import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const repository = "GrahamQuan/video-quick-editor";
const assetSchema = z.object({
  name: z.string(),
  state: z.literal("uploaded"),
  size: z
    .number()
    .int()
    .positive()
    .max(1024 * 1024 * 1024),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});

// Download only the selected repository release. Never accept a renderer URL or path.
export async function downloadInstaller(
  version: string,
  cache: string,
  progress: (fraction: number) => void,
  openPath: (path: string) => Promise<string>,
  request: typeof fetch = fetch,
): Promise<void> {
  if (!/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/.test(version))
    throw new Error("Invalid version");
  const signal = AbortSignal.timeout(15 * 60_000);
  const tag = encodeURIComponent(`v${version}`);
  const filename = `Video-Quick-Editor-${version}-mac-arm64.dmg`;
  const metadata = await request(
    `https://api.github.com/repos/${repository}/releases/tags/${tag}`,
    {
      signal,
      redirect: "error",
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    },
  );
  if (!metadata.ok) throw new Error("Release unavailable");
  const release = z
    .object({
      tag_name: z.literal(`v${version}`),
      draft: z.literal(false),
      assets: z.array(z.unknown()),
    })
    .parse(await metadata.json());
  const asset = release.assets
    .map((entry) => assetSchema.safeParse(entry))
    .find((entry) => entry.success && entry.data.name === filename);
  if (!asset?.success) throw new Error("Missing verified installer");
  let url = `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(filename)}`;
  let response: Response | undefined;
  for (let redirects = 0; redirects <= 5; redirects++) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      ![
        "github.com",
        "release-assets.githubusercontent.com",
        "objects.githubusercontent.com",
      ].includes(parsed.hostname)
    )
      throw new Error("Invalid download host");
    response = await request(url, { signal, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error("Missing download location");
    url = new URL(location, url).href;
  }
  if (!response?.ok || !response.body) throw new Error("Download failed");
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(join(cache, "installer-"));
  const temporary = join(directory, "download.partial");
  const target = join(directory, filename);
  let succeeded = false;
  try {
    const file = await open(temporary, "wx", 0o600);
    const hash = createHash("sha256");
    let received = 0;
    let lastPercent = -1;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > asset.data.size) throw new Error("Installer exceeds expected size");
        hash.update(value);
        await file.writeFile(value);
        const percent = Math.floor((received / asset.data.size) * 100);
        if (percent !== lastPercent) {
          lastPercent = percent;
          progress(received / asset.data.size);
        }
      }
      if (received !== asset.data.size || `sha256:${hash.digest("hex")}` !== asset.data.digest)
        throw new Error("Installer integrity check failed");
      await file.sync();
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      await file.close();
    }
    await rename(temporary, target);
    const error = await openPath(target);
    if (error) throw new Error("Could not open installer");
    succeeded = true;
  } finally {
    if (!succeeded) await rm(directory, { recursive: true, force: true });
  }
}
