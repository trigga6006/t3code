import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  WELCOME_HEADLINES,
  buildLandingTitleSeed,
  formatWelcomeOutgoingPrompt,
  pickWelcomeHeadline,
} from "./WelcomeLanding.logic";

describe("pickWelcomeHeadline", () => {
  it("returns a member of WELCOME_HEADLINES for in-range rng values", () => {
    for (const value of [0, 0.2, 0.4, 0.6, 0.8, 0.999]) {
      expect(WELCOME_HEADLINES).toContain(pickWelcomeHeadline(() => value));
    }
  });

  it("clamps boundary rng values to valid headlines", () => {
    expect(pickWelcomeHeadline(() => 0)).toBe(WELCOME_HEADLINES[0]);
    expect(pickWelcomeHeadline(() => 1)).toBe(WELCOME_HEADLINES[WELCOME_HEADLINES.length - 1]);
  });
});

describe("buildLandingTitleSeed", () => {
  it("prefers the trimmed prompt", () => {
    expect(
      buildLandingTitleSeed({ trimmedPrompt: "Fix the build", firstImageName: "shot.png" }),
    ).toBe("Fix the build");
  });

  it("falls back to the first image name", () => {
    expect(buildLandingTitleSeed({ trimmedPrompt: "", firstImageName: "shot.png" })).toBe(
      "Image: shot.png",
    );
  });

  it("falls back to terminal then element labels before 'New thread'", () => {
    expect(
      buildLandingTitleSeed({
        trimmedPrompt: "",
        firstImageName: null,
        firstTerminalLabel: "npm test",
        firstElementLabel: "button.submit",
      }),
    ).toBe("npm test");
    expect(
      buildLandingTitleSeed({
        trimmedPrompt: "",
        firstImageName: null,
        firstTerminalLabel: null,
        firstElementLabel: "button.submit",
      }),
    ).toBe("button.submit");
  });

  it("falls back to 'New thread' when nothing is provided", () => {
    expect(buildLandingTitleSeed({ trimmedPrompt: "", firstImageName: null })).toBe("New thread");
  });
});

describe("formatWelcomeOutgoingPrompt", () => {
  it("returns the trimmed text when no effort prefix applies", () => {
    expect(
      formatWelcomeOutgoingPrompt({
        provider: ProviderDriverKind.make("codex"),
        model: null,
        models: [],
        effort: null,
        text: "  hello world  ",
      }),
    ).toBe("hello world");
  });
});
