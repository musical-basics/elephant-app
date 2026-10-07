import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    completionAudio: {
      duration: number;
      peak: number;
      firstAudible: number;
      lastPeak: number;
    }[];
    audioContexts: number;
    audioDecodes: number;
    oscillators: number;
    audioEnds: number;
  }
}

test.beforeEach(async ({ page }) => {
  // Observe real browser playback and decoding, without replacing the audio data.
  await page.addInitScript(() => {
    window.completionAudio = [];
    window.audioContexts = 0;
    window.audioDecodes = 0;
    window.oscillators = 0;
    window.audioEnds = 0;
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        window.audioContexts++;
      }
      decodeAudioData(data: ArrayBuffer) {
        window.audioDecodes++;
        return super.decodeAudioData(data);
      }
      createOscillator() {
        window.oscillators++;
        return super.createOscillator();
      }
      createBufferSource() {
        const source = super.createBufferSource();
        const start = source.start.bind(source);
        source.start = (when?: number, offset?: number, duration?: number) => {
          const buffer = source.buffer!;
          const samples = buffer.getChannelData(0);
          let peak = 0;
          let firstAudible = -1;
          let lastPeak = 0;
          for (let i = 0; i < samples.length; i++) {
            peak = Math.max(peak, Math.abs(samples[i]));
            if (firstAudible < 0 && Math.abs(samples[i]) > 0.005)
              firstAudible = i / buffer.sampleRate;
            if (i > samples.length - 0.02 * buffer.sampleRate)
              lastPeak = Math.max(lastPeak, Math.abs(samples[i]));
          }
          window.completionAudio.push({
            duration: buffer.duration,
            peak,
            firstAudible,
            lastPeak,
          });
          source.addEventListener("ended", () => window.audioEnds++);
          start(when, offset, duration);
        };
        return source;
      }
    };
  });
});

test("preview plays the actual short acoustic asset, does not mutate work, and reuses its decoded clip", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const downloads: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("completion-marimba") &&
      !request.url().includes("?import")
    )
      downloads.push(request.url());
  });
  await page.goto("/#/still/settings");
  await expect(
    page.getByRole("button", { name: "Preview sound", exact: true }),
  ).toBeVisible();
  const before = await page.evaluate(() =>
    localStorage.getItem("elephant.workspace.local.v1"),
  );
  expect(await page.evaluate(() => window.audioContexts)).toBe(0);
  await page
    .getByRole("button", { name: "Preview sound", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.completionAudio.length))
    .toBe(1);
  const clip = await page.evaluate(() => window.completionAudio[0]);
  expect(clip.duration).toBeGreaterThan(0.85);
  expect(clip.duration).toBeLessThan(1);
  expect(clip.firstAudible).toBeLessThan(0.025);
  expect(clip.peak).toBeGreaterThan(0.3);
  expect(clip.peak).toBeLessThan(0.6);
  expect(clip.lastPeak).toBeLessThan(0.001);
  await page
    .getByRole("button", { name: "Preview sound", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Preview sound", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.completionAudio.length))
    .toBe(3);
  await expect.poll(() => page.evaluate(() => window.audioEnds)).toBe(3);
  expect(await page.evaluate(() => window.audioContexts)).toBe(1);
  expect(await page.evaluate(() => window.audioDecodes)).toBe(1);
  expect(await page.evaluate(() => window.oscillators)).toBe(0);
  expect(downloads).toHaveLength(1);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("elephant.workspace.local.v1"),
    ),
  ).toBe(before);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/elephant-completion-sound-settings.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("completion plays once after a timed task is confirmed, and stays quiet on cancellation", async ({
  page,
}) => {
  await page.goto("/#/still/focus");
  await page.getByRole("button", { name: "Add timer", exact: true }).click();
  await page.getByRole("button", { name: "Start timer", exact: true }).click();
  await page.getByRole("button", { name: /Completed!/ }).click();
  await page.getByRole("button", { name: "Keep working", exact: true }).click();
  expect(await page.evaluate(() => window.completionAudio)).toEqual([]);
  await page.getByRole("button", { name: /Completed!/ }).click();
  await page
    .getByRole("button", { name: "Complete without time", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.completionAudio.length))
    .toBe(1);
  await expect(
    page.getByRole("heading", { name: "Water the plants", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Completed!/ }).click();
  await expect
    .poll(() => page.evaluate(() => window.completionAudio.length))
    .toBe(2);
});

test("unavailable audio cannot prevent completing or saving a task", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.AudioContext = class {
      constructor() {
        throw new Error("Audio device unavailable");
      }
    } as unknown as typeof AudioContext;
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/still/focus");
  await page.getByRole("button", { name: /Completed!/ }).click();
  await expect(
    page.getByRole("heading", { name: "Water the plants", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Water the plants", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("a slow sound download never plays an old completion and can be used by the next click", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/completion-marimba.mp3", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/#/still/focus");
  await page.getByRole("button", { name: /Completed!/ }).click();
  await expect(
    page.getByRole("heading", { name: "Water the plants", exact: true }),
  ).toBeVisible();
  // Allow the deliberate 750 ms stale-feedback window to elapse.
  await page.waitForTimeout(850);
  const response = page.waitForResponse((response) =>
    response.url().endsWith("/completion-marimba.mp3"),
  );
  release();
  await response;
  await expect.poll(() => page.evaluate(() => window.audioDecodes)).toBe(1);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.completionAudio)).toEqual([]);
  await page.getByRole("button", { name: /Completed!/ }).click();
  await expect
    .poll(() => page.evaluate(() => window.completionAudio.length))
    .toBe(1);
});
