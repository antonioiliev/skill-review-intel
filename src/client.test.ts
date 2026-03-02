import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrightDataApiError, BrightDataClient } from "./client.js";
import type { ReviewIntelConfig } from "./types.js";

const TEST_CONFIG: ReviewIntelConfig = {
	apiKey: "test-key",
	timeoutMs: 60_000,
	datasetOverrides: {},
};

function mockResponse(
	status: number,
	body: unknown,
	headers?: Record<string, string>,
): Response {
	const headersObj = new Headers(headers);
	return {
		status,
		statusText: `Status ${status}`,
		ok: status >= 200 && status < 300,
		headers: headersObj,
		json: () => Promise.resolve(body),
		text: () =>
			Promise.resolve(
				typeof body === "string" ? body : JSON.stringify(body),
			),
	} as Response;
}

// ── BrightDataApiError ──────────────────────────────────────────────

describe("BrightDataApiError", () => {
	it("constructs with all fields populated", () => {
		const err = new BrightDataApiError({
			status: 400,
			code: "INVALID",
			errorType: "validation",
			fieldErrors: [["pages", "too large"]],
			rawBody: '{"error":"bad"}',
			message: "test message",
		});

		expect(err.status).toBe(400);
		expect(err.code).toBe("INVALID");
		expect(err.errorType).toBe("validation");
		expect(err.fieldErrors).toEqual([["pages", "too large"]]);
		expect(err.rawBody).toBe('{"error":"bad"}');
		expect(err.message).toBe("test message");
		expect(err.name).toBe("BrightDataApiError");
	});

	it("defaults fieldErrors to [] when omitted", () => {
		const err = new BrightDataApiError({
			status: 500,
			rawBody: "",
			message: "fail",
		});

		expect(err.fieldErrors).toEqual([]);
	});

	it("isValidationError true for status 400 + errorType validation", () => {
		const err = new BrightDataApiError({
			status: 400,
			errorType: "validation",
			rawBody: "",
			message: "",
		});

		expect(err.isValidationError).toBe(true);
	});

	it("isValidationError false for status 400 without errorType validation", () => {
		const err = new BrightDataApiError({
			status: 400,
			errorType: "other",
			rawBody: "",
			message: "",
		});

		expect(err.isValidationError).toBe(false);
	});

	it("isRateLimited true for status 429", () => {
		const err = new BrightDataApiError({
			status: 429,
			rawBody: "",
			message: "",
		});

		expect(err.isRateLimited).toBe(true);
	});

	it("isRateLimited false for non-429", () => {
		const err = new BrightDataApiError({
			status: 400,
			rawBody: "",
			message: "",
		});

		expect(err.isRateLimited).toBe(false);
	});

	it("rejectedFieldNames extracts field names from fieldErrors", () => {
		const err = new BrightDataApiError({
			status: 400,
			errorType: "validation",
			fieldErrors: [
				["pages", "too large"],
				["sort_by", "invalid value"],
			],
			rawBody: "",
			message: "",
		});

		expect(err.rejectedFieldNames).toEqual(["pages", "sort_by"]);
	});

	it("rejectedFieldNames returns [] when no fieldErrors", () => {
		const err = new BrightDataApiError({
			status: 400,
			rawBody: "",
			message: "",
		});

		expect(err.rejectedFieldNames).toEqual([]);
	});
});

// ── scrapeSync error handling ───────────────────────────────────────

describe("scrapeSync error handling", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns parsed JSON on 200", async () => {
		const data = [{ rating: 5, text: "Great" }];
		fetchMock.mockResolvedValueOnce(mockResponse(200, data));

		const client = new BrightDataClient(TEST_CONFIG);
		const result = await client.scrapeSync("g2_reviews", [
			{ url: "https://g2.com/products/slack/reviews" },
		]);

		expect(result).toEqual(data);
	});

	it("polls snapshot on 202 until ready", async () => {
		vi.useFakeTimers();

		const snapshotData = [{ rating: 4 }];

		// Initial POST → 202 with snapshot_id
		fetchMock.mockResolvedValueOnce(
			mockResponse(202, { snapshot_id: "snap-123" }),
		);
		// First poll → still running
		fetchMock.mockResolvedValueOnce(
			mockResponse(200, { status: "running" }),
		);
		// Second poll → ready
		fetchMock.mockResolvedValueOnce(
			mockResponse(200, { status: "ready" }),
		);
		// Snapshot fetch
		fetchMock.mockResolvedValueOnce(mockResponse(200, snapshotData));

		const client = new BrightDataClient(TEST_CONFIG);
		const resultPromise = client.scrapeSync("g2_reviews", [
			{ url: "https://g2.com/products/slack/reviews" },
		]);

		// Advance past poll delays
		await vi.advanceTimersByTimeAsync(2_000); // first poll delay
		await vi.advanceTimersByTimeAsync(3_000); // second poll delay (2000 * 1.5)

		const result = await resultPromise;
		expect(result).toEqual(snapshotData);
		expect(fetchMock).toHaveBeenCalledTimes(4);

		vi.useRealTimers();
	});

	it("throws BrightDataApiError with status 401", async () => {
		fetchMock.mockResolvedValueOnce(mockResponse(401, { error: "Unauthorized" }));

		const client = new BrightDataClient(TEST_CONFIG);

		await expect(
			client.scrapeSync("g2_reviews", [{ url: "https://g2.com/products/slack/reviews" }]),
		).rejects.toThrow(BrightDataApiError);

		try {
			fetchMock.mockResolvedValueOnce(mockResponse(401, { error: "Unauthorized" }));
			await client.scrapeSync("g2_reviews", [{ url: "https://g2.com/products/slack/reviews" }]);
		} catch (err) {
			expect(err).toBeInstanceOf(BrightDataApiError);
			const apiErr = err as BrightDataApiError;
			expect(apiErr.status).toBe(401);
			expect(apiErr.message).toBe("BrightData auth failed: invalid API key");
		}
	});

	it("throws BrightDataApiError with parsed fieldErrors for validation 400", async () => {
		const errorBody = {
			type: "validation",
			errors: [
				["pages", "must be <= 25"],
				["sort_by", "invalid value"],
			],
		};
		fetchMock.mockResolvedValueOnce(mockResponse(400, errorBody));

		const client = new BrightDataClient(TEST_CONFIG);

		try {
			await client.scrapeSync("g2_reviews", [{ url: "https://g2.com/products/slack/reviews" }]);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(BrightDataApiError);
			const apiErr = err as BrightDataApiError;
			expect(apiErr.status).toBe(400);
			expect(apiErr.errorType).toBe("validation");
			expect(apiErr.fieldErrors).toEqual([
				["pages", "must be <= 25"],
				["sort_by", "invalid value"],
			]);
			expect(apiErr.isValidationError).toBe(true);
			expect(apiErr.message).toContain("pages: must be <= 25");
		}
	});

	it("parses real BrightData production error payload (type field)", async () => {
		const errorBody = {
			error: "Invalid input provided",
			code: "validation_error",
			type: "validation",
			errors: [
				["num_of_reviews", "is not allowed for this dataset"],
				["min_rating", "is not allowed for this dataset"],
				["sort_filter", "is not allowed for this dataset"],
			],
		};
		fetchMock.mockResolvedValueOnce(mockResponse(400, errorBody));

		const client = new BrightDataClient(TEST_CONFIG);

		try {
			await client.scrapeSync("g2_reviews", [{ url: "https://g2.com/products/slack/reviews" }]);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(BrightDataApiError);
			const apiErr = err as BrightDataApiError;
			expect(apiErr.status).toBe(400);
			expect(apiErr.errorType).toBe("validation");
			expect(apiErr.code).toBe("validation_error");
			expect(apiErr.isValidationError).toBe(true);
			expect(apiErr.rejectedFieldNames).toEqual(["num_of_reviews", "min_rating", "sort_filter"]);
		}
	});

	it("throws BrightDataApiError with generic message for non-validation 400", async () => {
		const errorBody = { error: "something bad" };
		fetchMock.mockResolvedValueOnce(mockResponse(400, errorBody));

		const client = new BrightDataClient(TEST_CONFIG);

		try {
			await client.scrapeSync("g2_reviews", [{ url: "https://g2.com/products/slack/reviews" }]);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(BrightDataApiError);
			const apiErr = err as BrightDataApiError;
			expect(apiErr.status).toBe(400);
			expect(apiErr.isValidationError).toBe(false);
			expect(apiErr.message).toContain("BrightData bad request (400)");
		}
	});

	it("handles non-JSON response body gracefully", async () => {
		const textResponse = {
			status: 500,
			statusText: "Internal Server Error",
			ok: false,
			headers: new Headers(),
			json: () => Promise.reject(new Error("not JSON")),
			text: () => Promise.resolve("plain text error"),
		} as Response;
		fetchMock.mockResolvedValueOnce(textResponse);

		const client = new BrightDataClient(TEST_CONFIG);

		try {
			await client.scrapeSync("g2_reviews", [{ url: "https://g2.com/products/slack/reviews" }]);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(BrightDataApiError);
			const apiErr = err as BrightDataApiError;
			expect(apiErr.status).toBe(500);
			expect(apiErr.rawBody).toBe("plain text error");
		}
	});
});

// ── 429 rate-limit retry ────────────────────────────────────────────

describe("429 rate-limit retry", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.useFakeTimers();
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("retries once on first 429 and returns second response", async () => {
		const retryAfterSeconds = 3;
		const data = [{ rating: 5 }];

		fetchMock
			.mockResolvedValueOnce(
				mockResponse(429, { error: "rate limited" }, { "Retry-After": String(retryAfterSeconds) }),
			)
			.mockResolvedValueOnce(mockResponse(200, data));

		const client = new BrightDataClient(TEST_CONFIG);
		const resultPromise = client.scrapeSync("g2_reviews", [{ url: "https://g2.com/products/slack/reviews" }]);

		await vi.advanceTimersByTimeAsync(retryAfterSeconds * 1000);

		const result = await resultPromise;
		expect(result).toEqual(data);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("falls back to 5s wait when no Retry-After header", async () => {
		const data = [{ rating: 3 }];

		fetchMock
			.mockResolvedValueOnce(mockResponse(429, { error: "rate limited" }))
			.mockResolvedValueOnce(mockResponse(200, data));

		const client = new BrightDataClient(TEST_CONFIG);
		const resultPromise = client.scrapeSync("g2_reviews", [{ url: "https://g2.com/products/slack/reviews" }]);

		// Should not resolve before 5s
		await vi.advanceTimersByTimeAsync(4_999);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(1);

		const result = await resultPromise;
		expect(result).toEqual(data);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("caps Retry-After at 15s", async () => {
		const data = [{ rating: 4 }];

		fetchMock
			.mockResolvedValueOnce(
				mockResponse(429, { error: "rate limited" }, { "Retry-After": "60" }),
			)
			.mockResolvedValueOnce(mockResponse(200, data));

		const client = new BrightDataClient(TEST_CONFIG);
		const resultPromise = client.scrapeSync("g2_reviews", [{ url: "https://g2.com/products/slack/reviews" }]);

		// Should not resolve before 15s
		await vi.advanceTimersByTimeAsync(14_999);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(1);

		const result = await resultPromise;
		expect(result).toEqual(data);
	});

	it("throws BrightDataApiError if retry also returns error", async () => {
		fetchMock
			.mockResolvedValueOnce(
				mockResponse(429, { error: "rate limited" }, { "Retry-After": "1" }),
			)
			.mockResolvedValueOnce(mockResponse(500, { error: "server error" }));

		const client = new BrightDataClient(TEST_CONFIG);
		const resultPromise = client.scrapeSync("g2_reviews", [{ url: "https://g2.com/products/slack/reviews" }]);

		// Attach rejection handler BEFORE advancing timers to prevent unhandled rejection
		const assertion = expect(resultPromise).rejects.toThrow(BrightDataApiError);

		await vi.advanceTimersByTimeAsync(1_000);

		await assertion;
	});
});
