import { describe, expect, it } from "vitest";
import { settingsSchema } from "./index.js";

describe("settings language", () => {
  it("defaults existing settings to English", () => {
    const settings = settingsSchema.parse({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      defaultFontId: null,
      toolStatus: {
        available: false,
        ffmpegVersion: null,
        ffprobeVersion: null,
        missing: [],
      },
    });

    expect(settings.language).toBe("en");
  });
});

import { exportRequestSchema, agentToolSchemas } from "./index.js";
it("legacy requests retain source and tools reject arbitrary paths", () => {
  const request = {
    clips: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        assetId: "00000000-0000-4000-8000-000000000002",
        startUs: 0,
        endUs: 1,
      },
    ],
    mode: "accurate",
    modeWasManuallySelected: false,
    watermark: {
      enabled: false,
      text: "",
      fontId: null,
      position: "bottom-right",
      fontSize: 32,
      margin: 24,
    },
    output: null,
    videoCodec: null,
    normalize: { width: null, height: null, fps: null },
  };
  expect(exportRequestSchema.parse(request).outputProfile).toBe("source");
  expect(exportRequestSchema.parse(request).watermark.borderWidth).toBe(1);
  for (const borderWidth of [0, 4, 20]) {
    expect(
      exportRequestSchema.parse({ ...request, watermark: { ...request.watermark, borderWidth } })
        .watermark.borderWidth,
    ).toBe(borderWidth);
  }
  for (const borderWidth of [-1, 0.5, 21]) {
    expect(
      exportRequestSchema.safeParse({
        ...request,
        watermark: { ...request.watermark, borderWidth },
      }).success,
    ).toBe(false);
  }
  expect(
    exportRequestSchema.parse({ ...request, outputProfile: "mp4-compatible" }).outputProfile,
  ).toBe("mp4-compatible");
  expect(
    agentToolSchemas.set_output.safeParse({
      expectedRevision: 0,
      outputProfile: "source",
      path: "/tmp/forged",
    }).success,
  ).toBe(false);
});

import { saveModelProfileSchema, modelProfilesSchema } from "./index.js";
it("validates model collection limits and strips credential fields from public views", () => {
  const input = {
    expectedRevision: 0,
    name: "  Personal  ",
    baseURL: "https://example.com",
    modelId: "same-model",
  };
  expect(saveModelProfileSchema.parse(input).name).toBe("Personal");
  expect(saveModelProfileSchema.safeParse({ ...input, name: " " }).success).toBe(false);
  expect(saveModelProfileSchema.safeParse({ ...input, name: "x".repeat(81) }).success).toBe(false);
  expect(saveModelProfileSchema.safeParse({ ...input, expectedRevision: -1 }).success).toBe(false);
  const profile = {
    ...input,
    id: "00000000-0000-4000-8000-000000000001",
    hasApiKey: true,
    credentialRef: "hidden",
    apiKey: "secret",
  };
  const collection = {
    version: 1,
    revision: 0,
    profiles: [profile],
    selectedProfileId: profile.id,
  };
  expect(JSON.stringify(modelProfilesSchema.parse(collection))).not.toMatch(
    /secret|hidden|credentialRef|apiKey/,
  );
  expect(
    modelProfilesSchema.safeParse({ ...collection, profiles: Array(51).fill(profile) }).success,
  ).toBe(false);
});
