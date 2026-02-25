import { afterEach, describe, expect, it, vi } from "vitest";
import { detectPlatform, parseConfig, resolveDatasetId } from "./types.js";
import type { ReviewIntelConfig } from "./types.js";

describe("parseConfig", () => {
	afterEach(() => vi.unstubAllEnvs());

	it("accepts valid config and returns ReviewIntelConfig", () => {
		const cfg = parseConfig({ apiKey: "test-key-123" });
		expect(cfg.apiKey).toBe("test-key-123");
		expect(cfg.timeoutMs).toBe(120_000);
		expect(cfg.datasetOverrides).toEqual({});
	});

	it("accepts custom timeoutMs and datasetOverrides", () => {
		const cfg = parseConfig({
			apiKey: "key",
			timeoutMs: 60_000,
			datasetOverrides: { g2_reviews: "custom-id" },
		});
		expect(cfg.timeoutMs).toBe(60_000);
		expect(cfg.datasetOverrides).toEqual({ g2_reviews: "custom-id" });
	});

	it("throws on missing apiKey", () => {
		expect(() => parseConfig({})).toThrow("review-intel apiKey is required");
	});

	it("throws on empty apiKey", () => {
		expect(() => parseConfig({ apiKey: "  " })).toThrow(
			"review-intel apiKey is required",
		);
	});

	it("resolves environment variable substitution in apiKey", () => {
		vi.stubEnv("MY_BD_KEY", "resolved-key-value");
		const cfg = parseConfig({ apiKey: "${MY_BD_KEY}" });
		expect(cfg.apiKey).toBe("resolved-key-value");
	});

	it("throws on unresolvable environment variable", () => {
		delete process.env.NONEXISTENT_VAR;
		expect(() => parseConfig({ apiKey: "${NONEXISTENT_VAR}" })).toThrow(
			"Environment variable NONEXISTENT_VAR is not set",
		);
	});

	it("throws on unknown config keys", () => {
		expect(() => parseConfig({ apiKey: "key", badKey: "val" })).toThrow(
			"review-intel config has unknown keys: badKey",
		);
	});

	it("throws on non-object config", () => {
		expect(() => parseConfig(null)).toThrow("review-intel config required");
		expect(() => parseConfig("string")).toThrow(
			"review-intel config required",
		);
		expect(() => parseConfig([1, 2])).toThrow(
			"review-intel config required",
		);
	});

	it("throws on timeoutMs out of range", () => {
		expect(() => parseConfig({ apiKey: "key", timeoutMs: 1000 })).toThrow(
			"review-intel timeoutMs must be between 5000 and 300000",
		);
		expect(() =>
			parseConfig({ apiKey: "key", timeoutMs: 500_000 }),
		).toThrow("review-intel timeoutMs must be between 5000 and 300000");
	});
});

describe("detectPlatform", () => {
	it("detects Google Play", () => {
		expect(
			detectPlatform(
				"https://play.google.com/store/apps/details?id=com.example",
			),
		).toBe("google_play");
	});

	it("detects Apple App Store", () => {
		expect(
			detectPlatform("https://apps.apple.com/us/app/example/id123456789"),
		).toBe("apple_appstore");
	});

	it("detects G2", () => {
		expect(
			detectPlatform(
				"https://www.g2.com/products/slack/reviews",
			),
		).toBe("g2");
	});

	it("detects Trustpilot", () => {
		expect(
			detectPlatform("https://www.trustpilot.com/review/example.com"),
		).toBe("trustpilot");
	});

	it("returns undefined for unknown URLs", () => {
		expect(detectPlatform("https://example.com")).toBeUndefined();
		expect(
			detectPlatform("https://youtube.com/watch?v=abc"),
		).toBeUndefined();
		expect(
			detectPlatform("https://www.capterra.com/p/123/Product/"),
		).toBeUndefined();
	});
});

describe("resolveDatasetId", () => {
	const baseCfg: ReviewIntelConfig = {
		apiKey: "key",
		timeoutMs: 120_000,
		datasetOverrides: {},
	};

	it("returns default dataset ID when no override", () => {
		const id = resolveDatasetId(baseCfg, "g2_reviews");
		expect(id).toBe("gd_l88xvdka1uao86xvlb");
	});

	it("returns override when present", () => {
		const cfg: ReviewIntelConfig = {
			...baseCfg,
			datasetOverrides: { g2_reviews: "custom-override" },
		};
		const id = resolveDatasetId(cfg, "g2_reviews");
		expect(id).toBe("custom-override");
	});

	it("returns key itself when no default and no override", () => {
		const id = resolveDatasetId(baseCfg, "unknown_key");
		expect(id).toBe("unknown_key");
	});
});
