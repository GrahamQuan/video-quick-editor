import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { mediaResponse } from "./media-response.js";

let directory: string;
let path: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "media-range-"));
  path = join(directory, "fixture.mp4");
  await writeFile(path, "0123456789");
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});
it("advertises a known length and seekable bytes", async () => {
  const response = await mediaResponse(new Request("https://media/asset"), path);
  expect(response.headers.get("accept-ranges")).toBe("bytes");
  expect(response.headers.get("content-length")).toBe("10");
  expect(await response.text()).toBe("0123456789");
});
it.each([
  ["bytes=2-5", "2345", "bytes 2-5/10"],
  ["bytes=7-", "789", "bytes 7-9/10"],
  ["bytes=-2", "89", "bytes 8-9/10"],
  ["bytes=8-20", "89", "bytes 8-9/10"],
])("serves %s", async (range, body, contentRange) => {
  const response = await mediaResponse(
    new Request("https://media/asset", { headers: { range } }),
    path,
  );
  expect(response.status).toBe(206);
  expect(response.headers.get("content-range")).toBe(contentRange);
  expect(response.headers.get("content-length")).toBe(String(body.length));
  expect(await response.text()).toBe(body);
});
it.each(["bytes=10-", "bytes=5-2", "bytes=-0", "bytes=", "bytes=0-1,4-5"])(
  "rejects invalid range %s",
  async (range) => {
    const response = await mediaResponse(
      new Request("https://media/asset", { headers: { range } }),
      path,
    );
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */10");
  },
);
