import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	BrightDataApiError,
	type BrightDataClient,
	type ScrapeResult,
} from "../client.js";
import { executePlatformScrape, formatReviewLine } from "./shared.js";

const G2_URL = "https://www.g2.com/products/slack/reviews";
const GOOGLE_PLAY_URL =
	"https://play.google.com/store/apps/details?id=com.example";
const TRUSTPILOT_URL = "https://www.trustpilot.com/review/example.com";

const ALL_PLATFORMS = [
	"google_play",
	"apple_appstore",
	"g2",
	"trustpilot",
] as const;

function mockClient(
	impl?: (...args: unknown[]) => Promise<ScrapeResult>,
): BrightDataClient {
	return {
		scrapeSync: vi.fn(impl ?? (() => Promise.resolve([]))),
	} as unknown as BrightDataClient;
}

function mockClientSequence(
	...calls: Array<ScrapeResult | Error>
): BrightDataClient {
	const fn = vi.fn();
	for (const call of calls) {
		if (call instanceof Error) {
			fn.mockRejectedValueOnce(call);
		} else {
			fn.mockResolvedValueOnce(call);
		}
	}
	return { scrapeSync: fn } as unknown as BrightDataClient;
}

function makeValidationError(
	fieldErrors: Array<[string, string]>,
): BrightDataApiError {
	return new BrightDataApiError({
		status: 400,
		errorType: "validation",
		fieldErrors,
		rawBody: "{}",
		message: `BrightData validation error: ${fieldErrors.map(([f, r]) => `${f}: ${r}`).join("; ")}`,
	});
}

function makeReviews(count: number): ScrapeResult {
	return Array.from({ length: count }, (_, i) => ({
		rating: (i % 5) + 1,
		review_text: `Review ${i + 1}`,
		date: `2025-01-${String((i % 28) + 1).padStart(2, "0")}`,
	}));
}

// ── basic flow ──────────────────────────────────────────────────────

describe("executePlatformScrape — basic flow", () => {
	it("throws if url is missing", async () => {
		const client = mockClient();
		await expect(
			executePlatformScrape(client, {}, [...ALL_PLATFORMS], "reviews"),
		).rejects.toThrow("url is required");
	});

	it("throws if url is empty", async () => {
		const client = mockClient();
		await expect(
			executePlatformScrape(
				client,
				{ url: "  " },
				[...ALL_PLATFORMS],
				"reviews",
			),
		).rejects.toThrow("url is required");
	});

	it("throws if platform cannot be detected", async () => {
		const client = mockClient();
		await expect(
			executePlatformScrape(
				client,
				{ url: "https://example.com/reviews" },
				[...ALL_PLATFORMS],
				"reviews",
			),
		).rejects.toThrow("Could not detect platform from URL");
	});

	it("returns null when client returns empty results", async () => {
		const client = mockClient(() => Promise.resolve([]));

		const result = await executePlatformScrape(
			client,
			{ url: G2_URL },
			[...ALL_PLATFORMS],
			"reviews",
		);

		expect(result).toBeNull();
	});

	it("formats Trustpilot-shaped reviews (review_content, reviewer_name)", () => {
		const review = {
			review_content: "Great product, highly recommend!",
			review_title: "Five stars",
			reviewer_name: "Jane D.",
			review_rating: 5,
			review_date: "2025-06-15",
		};

		const line = formatReviewLine(0, review);
		expect(line).toContain("Great product, highly recommend!");
		expect(line).toContain("Jane D.");
		expect(line).not.toContain("No text");
	});

	it("falls back to review_title when no content field exists", () => {
		const review = {
			review_title: "Decent service",
			reviewer_name: "Bob",
			review_rating: 3,
		};

		const line = formatReviewLine(0, review);
		expect(line).toContain("Decent service");
		expect(line).not.toContain("No text");
	});

	it("formats Apple App Store bare `review` field correctly", () => {
		const review = {
			review: "Great app",
			review_rating: 5,
			reviewer_name: "Nico",
			review_date: "2025-10-27",
		};

		const line = formatReviewLine(0, review);
		expect(line).toContain("Great app");
		expect(line).not.toContain("No text");
	});

	it("joins G2 array text field cleanly instead of comma-separating", () => {
		const review = {
			text: [
				"Question: What do you like? - Answer: Great.",
				"Question: Dislike? - Answer: Nothing.",
			],
			stars: 5,
			author: "Nic",
			date: "2024-04-18",
		};

		const line = formatReviewLine(0, review);
		// Should contain actual text, not ugly String([...]) comma output
		expect(line).toContain("What do you like");
		expect(line).not.toContain("No text");
	});

	it("flattens Google Play nested reviews wrapper", async () => {
		const nestedResponse = [
			{
				url: "https://play.google.com/store/apps/details?id=com.example",
				title: "App Name",
				rating: 4.5,
				reviews: [
					{
						review: "Great",
						review_rating: 5,
						reviewer_name: "A",
						date: "2025-01-01",
					},
					{
						review: "Bad",
						review_rating: 1,
						reviewer_name: "B",
						date: "2025-01-02",
					},
				],
			},
		];
		const client = mockClient(() => Promise.resolve(nestedResponse));

		const result = await executePlatformScrape(
			client,
			{ url: GOOGLE_PLAY_URL },
			[...ALL_PLATFORMS],
			"reviews",
		);

		expect(result).not.toBeNull();
		expect(result!.results).toHaveLength(2);
		expect(result!.metadata.received.count).toBe(2);
	});

	it("renders found_helpful via extras callback", () => {
		const review = {
			review: "Helpful review",
			review_rating: 4,
			found_helpful: 42,
		};

		const line = formatReviewLine(0, review, (r) => {
			const helpful =
				r.helpful_count ?? r.found_helpful ?? r.helpful_votes ?? r.thumbs_up;
			return helpful != null ? `Helpful: ${helpful}` : "";
		});

		expect(line).toContain("Helpful: 42");
		expect(line).toContain("Helpful review");
	});

	it("returns results with populated metadata on success", async () => {
		const reviews = makeReviews(10);
		const client = mockClient(() => Promise.resolve(reviews));

		const result = await executePlatformScrape(
			client,
			{ url: G2_URL },
			[...ALL_PLATFORMS],
			"reviews",
		);

		expect(result).not.toBeNull();
		expect(result!.platform).toBe("g2");
		expect(result!.url).toBe(G2_URL);
		expect(result!.results).toHaveLength(10);
		expect(result!.metadata.received.count).toBe(10);
		expect(result!.metadata.received.dateRange.earliest).toBeTruthy();
		expect(result!.metadata.received.dateRange.latest).toBeTruthy();
		expect(result!.metadata.retried).toBe(false);
	});
});

// ── parameter filtering ─────────────────────────────────────────────

describe("executePlatformScrape — parameter filtering", () => {
	it("applies platform defaults (G2 → pages: 50)", async () => {
		const fn = vi.fn().mockResolvedValue(makeReviews(5));
		const client = { scrapeSync: fn } as unknown as BrightDataClient;

		await executePlatformScrape(
			client,
			{ url: G2_URL },
			[...ALL_PLATFORMS],
			"reviews",
		);

		const input = fn.mock.calls[0][1][0];
		expect(input.pages).toBe(50);
	});

	it("user params override defaults", async () => {
		const fn = vi.fn().mockResolvedValue(makeReviews(5));
		const client = { scrapeSync: fn } as unknown as BrightDataClient;

		await executePlatformScrape(
			client,
			{ url: G2_URL, pages: 10 },
			[...ALL_PLATFORMS],
			"reviews",
		);

		const input = fn.mock.calls[0][1][0];
		expect(input.pages).toBe(10);
	});

	it("strips params not in allowlist", async () => {
		const fn = vi.fn().mockResolvedValue(makeReviews(5));
		const client = { scrapeSync: fn } as unknown as BrightDataClient;

		await executePlatformScrape(
			client,
			{ url: G2_URL, num_of_reviews: 100, unknown_param: "bad" },
			[...ALL_PLATFORMS],
			"reviews",
		);

		const input = fn.mock.calls[0][1][0];
		expect(input.num_of_reviews).toBeUndefined();
		expect(input.unknown_param).toBeUndefined();
		// url and pages (default) should be present
		expect(input.url).toBe(G2_URL);
		expect(input.pages).toBe(50);
	});
});

// ── validation retry ────────────────────────────────────────────────

describe("executePlatformScrape — validation retry", () => {
	it("retries after stripping rejected fields", async () => {
		const reviews = makeReviews(5);
		const client = mockClientSequence(
			makeValidationError([["pages", "must be <= 25"]]),
			reviews,
		);

		const result = await executePlatformScrape(
			client,
			{ url: G2_URL, pages: 100 },
			[...ALL_PLATFORMS],
			"reviews",
		);

		expect(result).not.toBeNull();
		expect(result!.results).toHaveLength(5);

		// Verify second call omits stripped field
		const fn = client.scrapeSync as ReturnType<typeof vi.fn>;
		expect(fn).toHaveBeenCalledTimes(2);
		const retryInput = fn.mock.calls[1][1][0];
		expect(retryInput.pages).toBeUndefined();
		expect(retryInput.url).toBe(G2_URL);
	});

	it("sets metadata.retried=true and populates strippedFields", async () => {
		const client = mockClientSequence(
			makeValidationError([
				["pages", "must be <= 25"],
				["sort_by", "invalid"],
			]),
			makeReviews(3),
		);

		const result = await executePlatformScrape(
			client,
			{ url: G2_URL, pages: 100, sort_by: "bad" },
			[...ALL_PLATFORMS],
			"reviews",
		);

		expect(result!.metadata.retried).toBe(true);
		expect(result!.metadata.strippedFields).toEqual(["pages", "sort_by"]);
	});

	it("adds auto-retry warning to metadata.warnings", async () => {
		const client = mockClientSequence(
			makeValidationError([["pages", "must be <= 25"]]),
			makeReviews(3),
		);

		const result = await executePlatformScrape(
			client,
			{ url: G2_URL, pages: 100 },
			[...ALL_PLATFORMS],
			"reviews",
		);

		expect(result!.metadata.warnings).toEqual(
			expect.arrayContaining([
				expect.stringContaining("Auto-retried after validation error"),
			]),
		);
		expect(result!.metadata.warnings[0]).toContain("pages");
	});

	it("retries using real BrightData error shape (type field, not error_type)", async () => {
		const reviews = makeReviews(5);
		// Simulate the exact error BrightData sends in production: "type" not "error_type"
		const prodError = new BrightDataApiError({
			status: 400,
			errorType: "validation",
			fieldErrors: [
				["num_of_reviews", "is not allowed for this dataset"],
				["min_rating", "is not allowed for this dataset"],
			],
			rawBody: JSON.stringify({
				error: "Invalid input provided",
				code: "validation_error",
				type: "validation",
				errors: [
					["num_of_reviews", "is not allowed for this dataset"],
					["min_rating", "is not allowed for this dataset"],
				],
			}),
			message:
				"BrightData validation error: num_of_reviews: is not allowed for this dataset; min_rating: is not allowed for this dataset",
		});

		const client = mockClientSequence(prodError, reviews);

		const result = await executePlatformScrape(
			client,
			{ url: GOOGLE_PLAY_URL, num_of_reviews: 100, min_rating: 4 },
			[...ALL_PLATFORMS],
			"reviews",
		);

		expect(result).not.toBeNull();
		expect(result!.metadata.retried).toBe(true);
		expect(result!.metadata.strippedFields).toEqual([
			"num_of_reviews",
			"min_rating",
		]);

		const fn = client.scrapeSync as ReturnType<typeof vi.fn>;
		expect(fn).toHaveBeenCalledTimes(2);
		const retryInput = fn.mock.calls[1][1][0];
		expect(retryInput.num_of_reviews).toBeUndefined();
		expect(retryInput.min_rating).toBeUndefined();
		expect(retryInput.url).toBe(GOOGLE_PLAY_URL);
	});

	it("throws actionable error if retry also fails", async () => {
		const client = mockClientSequence(
			makeValidationError([["pages", "must be <= 25"]]),
			new BrightDataApiError({
				status: 400,
				errorType: "validation",
				fieldErrors: [["url", "invalid"]],
				rawBody: "{}",
				message: "BrightData validation error: url: invalid",
			}),
		);

		await expect(
			executePlatformScrape(
				client,
				{ url: G2_URL, pages: 100 },
				[...ALL_PLATFORMS],
				"reviews",
			),
		).rejects.toThrow(/Suggested next steps/);
	});
});

// ── actionable errors ───────────────────────────────────────────────

describe("executePlatformScrape — actionable errors", () => {
	it("rate-limit error includes wait and browser agent suggestions", async () => {
		const client = mockClientSequence(
			new BrightDataApiError({
				status: 429,
				rawBody: "{}",
				message: "BrightData rate limited.",
			}),
		);

		try {
			await executePlatformScrape(
				client,
				{ url: G2_URL },
				[...ALL_PLATFORMS],
				"reviews",
			);
			expect.unreachable("should have thrown");
		} catch (err) {
			const msg = (err as Error).message;
			expect(msg).toContain("Wait 30-60 seconds");
			expect(msg).toContain("browser agent");
		}
	});

	it("validation error with no field names throws actionable error", async () => {
		const client = mockClientSequence(
			new BrightDataApiError({
				status: 400,
				errorType: "validation",
				fieldErrors: [],
				rawBody: "{}",
				message: "BrightData validation error",
			}),
		);

		try {
			await executePlatformScrape(
				client,
				{ url: G2_URL },
				[...ALL_PLATFORMS],
				"reviews",
			);
			expect.unreachable("should have thrown");
		} catch (err) {
			const msg = (err as Error).message;
			expect(msg).toContain("Simplify the request");
			expect(msg).toContain("browser agent");
		}
	});

	it("generic BrightDataApiError (500) suggests check URL and browser agent", async () => {
		const client = mockClientSequence(
			new BrightDataApiError({
				status: 500,
				rawBody: "Internal error",
				message: "BrightData API error (500): Internal error",
			}),
		);

		try {
			await executePlatformScrape(
				client,
				{ url: G2_URL },
				[...ALL_PLATFORMS],
				"reviews",
			);
			expect.unreachable("should have thrown");
		} catch (err) {
			const msg = (err as Error).message;
			expect(msg).toContain("Check the URL");
			expect(msg).toContain("browser agent");
		}
	});

	it("timeout error suggests fewer reviews and browser agent", async () => {
		const client = mockClientSequence(
			new Error("BrightData request timed out"),
		);

		try {
			await executePlatformScrape(
				client,
				{ url: G2_URL },
				[...ALL_PLATFORMS],
				"reviews",
			);
			expect.unreachable("should have thrown");
		} catch (err) {
			const msg = (err as Error).message;
			expect(msg).toContain("fewer reviews/pages");
			expect(msg).toContain("browser agent");
		}
	});

	it("unknown error includes browser agent as fallback", async () => {
		const client = mockClientSequence(new Error("something unexpected"));

		try {
			await executePlatformScrape(
				client,
				{ url: G2_URL },
				[...ALL_PLATFORMS],
				"reviews",
			);
			expect.unreachable("should have thrown");
		} catch (err) {
			const msg = (err as Error).message;
			expect(msg).toContain("browser agent");
			expect(msg).toContain("something unexpected");
		}
	});
});

// ── under-collection warnings ───────────────────────────────────────

describe("executePlatformScrape — under-collection warnings", () => {
	it("warns when received < 50% of requested num_of_reviews", async () => {
		const client = mockClient(() => Promise.resolve(makeReviews(20)));

		const result = await executePlatformScrape(
			client,
			{ url: GOOGLE_PLAY_URL, num_of_reviews: 100 },
			[...ALL_PLATFORMS],
			"reviews",
		);

		expect(result!.metadata.warnings).toEqual(
			expect.arrayContaining([
				expect.stringContaining("Requested 100 reviews but received 20"),
			]),
		);
	});

	it("no warning when received >= 50% of requested num_of_reviews", async () => {
		const client = mockClient(() => Promise.resolve(makeReviews(60)));

		const result = await executePlatformScrape(
			client,
			{ url: GOOGLE_PLAY_URL, num_of_reviews: 100 },
			[...ALL_PLATFORMS],
			"reviews",
		);

		const underCollectionWarnings = result!.metadata.warnings.filter((w) =>
			w.includes("Requested"),
		);
		expect(underCollectionWarnings).toHaveLength(0);
	});

	it("warns when received < requestedPages * 5", async () => {
		const client = mockClient(() => Promise.resolve(makeReviews(10)));

		const result = await executePlatformScrape(
			client,
			{ url: G2_URL, pages: 20 },
			[...ALL_PLATFORMS],
			"reviews",
		);

		expect(result!.metadata.warnings).toEqual(
			expect.arrayContaining([expect.stringContaining("Requested 20 pages")]),
		);
	});

	it("no warning when received >= requestedPages * 5", async () => {
		const client = mockClient(() => Promise.resolve(makeReviews(200)));

		const result = await executePlatformScrape(
			client,
			{ url: G2_URL, pages: 20 },
			[...ALL_PLATFORMS],
			"reviews",
		);

		const pageWarnings = result!.metadata.warnings.filter((w) =>
			w.includes("pages"),
		);
		expect(pageWarnings).toHaveLength(0);
	});

	it("no warnings when neither count param was requested (Trustpilot)", async () => {
		const client = mockClient(() => Promise.resolve(makeReviews(3)));

		const result = await executePlatformScrape(
			client,
			{ url: TRUSTPILOT_URL },
			[...ALL_PLATFORMS],
			"reviews",
		);

		expect(result!.metadata.warnings).toHaveLength(0);
	});

	it("warns when >90% of reviews have no text content", async () => {
		const textlessReviews = Array.from({ length: 10 }, (_, i) => ({
			rating: (i % 5) + 1,
			date: `2025-01-${String((i % 28) + 1).padStart(2, "0")}`,
		}));
		const client = mockClient(() => Promise.resolve(textlessReviews));

		const result = await executePlatformScrape(
			client,
			{ url: TRUSTPILOT_URL },
			[...ALL_PLATFORMS],
			"reviews",
		);

		expect(result!.metadata.warnings).toEqual(
			expect.arrayContaining([
				expect.stringContaining("10 of 10 reviews have no text content"),
			]),
		);
	});

	it("no-text warning includes sample field names for debugging", async () => {
		const textlessReviews = Array.from({ length: 10 }, (_, i) => ({
			rating: (i % 5) + 1,
			date: `2025-01-${String((i % 28) + 1).padStart(2, "0")}`,
			some_unknown_field: "value",
		}));
		const client = mockClient(() => Promise.resolve(textlessReviews));

		const result = await executePlatformScrape(
			client,
			{ url: TRUSTPILOT_URL },
			[...ALL_PLATFORMS],
			"reviews",
		);

		const noTextWarning = result!.metadata.warnings.find((w) =>
			w.includes("no text content"),
		);
		expect(noTextWarning).toBeDefined();
		expect(noTextWarning).toContain("Sample review fields:");
		expect(noTextWarning).toContain("some_unknown_field");
	});

	it("no text warning does not trigger when most reviews have text", async () => {
		// All reviews have review_content
		const reviews = Array.from({ length: 10 }, (_, i) => ({
			review_content: `Review ${i}`,
			rating: (i % 5) + 1,
			date: `2025-01-${String((i % 28) + 1).padStart(2, "0")}`,
		}));
		const client = mockClient(() => Promise.resolve(reviews));

		const result = await executePlatformScrape(
			client,
			{ url: TRUSTPILOT_URL },
			[...ALL_PLATFORMS],
			"reviews",
		);

		const textWarnings = result!.metadata.warnings.filter((w) =>
			w.includes("no text content"),
		);
		expect(textWarnings).toHaveLength(0);
	});
});
