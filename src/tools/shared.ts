import {
	BrightDataApiError,
	type BrightDataClient,
	type ScrapeResult,
} from "../client.js";
import { detectPlatform } from "../types.js";

/**
 * Allowlist of params each BrightData dataset actually accepts (beyond `url`).
 * Any param not in this set is silently dropped — prevents 400s from
 * hallucinated or unsupported fields like num_of_reviews on G2, max_rating, etc.
 */
const DATASET_ALLOWED_PARAMS: Record<string, ReadonlySet<string>> = {
	g2_reviews: new Set(["pages", "start_date", "end_date", "sort_by"]),
	trustpilot_reviews: new Set(["start_date", "end_date", "sort_by"]),
	google_play_reviews: new Set(["num_of_reviews", "start_date", "end_date", "sort_by", "min_rating", "max_rating"]),
	apple_appstore_reviews: new Set(["num_of_reviews", "start_date", "end_date", "sort_by", "min_rating", "max_rating"]),
};

/** Per-platform defaults for maximizing review collection. User params override these. */
const PLATFORM_DEFAULTS: Record<string, Record<string, unknown>> = {
	g2_reviews: { pages: 50 },
	trustpilot_reviews: {},
	google_play_reviews: { num_of_reviews: 500 },
	apple_appstore_reviews: { num_of_reviews: 500 },
};

/** Progress metadata returned alongside scrape results. */
export type ScrapeMetadata = {
	requested: { numOfReviews?: number; pages?: number; platform: string };
	received: {
		count: number;
		dateRange: { earliest: string | null; latest: string | null };
	};
	warnings: string[];
	retried: boolean;
	strippedFields: string[];
};

/**
 * Shared execute flow for platform-based scrape tools.
 * Returns the detected platform, results, and collection metadata — or null if no data.
 *
 * On BrightData validation errors (400), strips rejected fields and retries once.
 * On exhausted retries, throws an actionable error with suggested next steps.
 */
export async function executePlatformScrape(
	client: BrightDataClient,
	params: Record<string, unknown>,
	allowedPlatforms: readonly string[],
	datasetSuffix: string,
): Promise<{
	platform: string;
	results: Record<string, unknown>[];
	url: string;
	metadata: ScrapeMetadata;
} | null> {
	const url = String(params.url ?? "").trim();
	if (!url) throw new Error("url is required");

	const platform =
		(typeof params.platform === "string" ? params.platform : undefined) ??
		detectPlatform(url);

	if (!platform || !allowedPlatforms.includes(platform)) {
		throw new Error(
			`Could not detect platform from URL. Provide a platform parameter (${allowedPlatforms.join(", ")}).`,
		);
	}

	const datasetKey = `${platform}_${datasetSuffix}`;
	const allowed = DATASET_ALLOWED_PARAMS[datasetKey];
	const defaults = PLATFORM_DEFAULTS[datasetKey] ?? {};

	// Start with platform defaults, then layer user params on top (user wins).
	// Only forward params that the dataset actually accepts (allowlist).
	const input: Record<string, unknown> = { ...defaults, url };
	for (const [key, value] of Object.entries(params)) {
		if (key === "url" || key === "platform") continue;
		if (value == null) continue;
		if (typeof value === "string" && value.trim() === "") continue;
		if (allowed && !allowed.has(key)) continue;
		input[key] = value;
	}

	// Track what was requested for metadata
	const requestedReviews =
		typeof input.num_of_reviews === "number"
			? input.num_of_reviews
			: undefined;
	const requestedPages =
		typeof input.pages === "number" ? input.pages : undefined;

	const metadata: ScrapeMetadata = {
		requested: { numOfReviews: requestedReviews, pages: requestedPages, platform },
		received: { count: 0, dateRange: { earliest: null, latest: null } },
		warnings: [],
		retried: false,
		strippedFields: [],
	};

	let results: ScrapeResult;

	try {
		results = await client.scrapeSync(datasetKey, [input]);
	} catch (err) {
		// Validation retry: strip rejected fields and try once more
		if (
			err instanceof BrightDataApiError &&
			err.isValidationError &&
			err.rejectedFieldNames.length > 0
		) {
			const stripped = err.rejectedFieldNames;
			const retryInput = { ...input };
			for (const field of stripped) {
				delete retryInput[field];
			}

			metadata.retried = true;
			metadata.strippedFields = stripped;
			metadata.warnings.push(
				`Auto-retried after validation error. Stripped fields: ${stripped.join(", ")}.`,
			);

			try {
				results = await client.scrapeSync(datasetKey, [retryInput]);
			} catch (retryErr) {
				throw toActionableError(retryErr, platform);
			}
		} else {
			throw toActionableError(err, platform);
		}
	}

	if (!results.length) return null;

	// Populate received metadata
	const stats = computeDateRange(results);
	metadata.received = { count: results.length, dateRange: stats };

	// Under-collection warnings
	if (requestedReviews != null && results.length < requestedReviews * 0.5) {
		metadata.warnings.push(
			`Requested ${requestedReviews} reviews but received ${results.length}. The platform may have fewer reviews, or try different date ranges / filters.`,
		);
	}

	if (requestedPages != null) {
		// G2 returns ~10 reviews per page
		const expectedMin = requestedPages * 5; // conservative: 5 per page
		if (results.length < expectedMin) {
			metadata.warnings.push(
				`Requested ${requestedPages} pages (~${requestedPages * 10} reviews) but received ${results.length}. The product may have fewer reviews.`,
			);
		}
	}

	return { platform, results, url, metadata };
}

/**
 * Convert any error into an actionable message with concrete next steps.
 * Always includes browser fallback as last suggestion.
 */
function toActionableError(err: unknown, platform: string): Error {
	const suggestions: string[] = [];

	if (err instanceof BrightDataApiError) {
		if (err.isRateLimited) {
			suggestions.push(
				"Wait 30-60 seconds and retry the request.",
				"Reduce the number of reviews/pages requested.",
				`Fall back to the browser agent to visit the ${platform} review page directly.`,
			);
		} else if (err.isValidationError) {
			suggestions.push(
				"Simplify the request: use only the url parameter, remove all filters.",
				`Fall back to the browser agent to visit the ${platform} review page directly.`,
			);
		} else {
			suggestions.push(
				"Check the URL is correct and accessible.",
				`Fall back to the browser agent to visit the ${platform} review page directly.`,
			);
		}

		const nextSteps = suggestions
			.map((s, i) => `${i + 1}. ${s}`)
			.join("\n");

		return new Error(`${err.message}\n\nSuggested next steps:\n${nextSteps}`);
	}

	// Timeout / abort errors
	if (
		err instanceof Error &&
		(err.message.includes("timed out") || err.message.includes("abort"))
	) {
		suggestions.push(
			"Retry with fewer reviews/pages to reduce scrape time.",
			`Fall back to the browser agent to visit the ${platform} review page directly.`,
		);

		const nextSteps = suggestions
			.map((s, i) => `${i + 1}. ${s}`)
			.join("\n");

		return new Error(`${err.message}\n\nSuggested next steps:\n${nextSteps}`);
	}

	// Unknown errors — pass through with a fallback suggestion
	const message =
		err instanceof Error ? err.message : "Unknown error occurred";
	return new Error(
		`${message}\n\nSuggested next steps:\n1. Fall back to the browser agent to visit the ${platform} review page directly.`,
	);
}

/** Extract earliest/latest dates from results (for metadata). */
function computeDateRange(
	reviews: Record<string, unknown>[],
): { earliest: string | null; latest: string | null } {
	let earliest: string | null = null;
	let latest: string | null = null;

	for (const review of reviews) {
		const raw = coalesce(review, "date", "review_date", "timestamp");
		if (raw == null) continue;
		const date = String(raw);
		if (!earliest || date < earliest) earliest = date;
		if (!latest || date > latest) latest = date;
	}

	return { earliest, latest };
}

/** Pick the first non-null value from an object for the given keys. */
export function coalesce(
	obj: Record<string, unknown>,
	...keys: string[]
): unknown | undefined {
	for (const k of keys) {
		if (obj[k] != null) return obj[k];
	}
	return undefined;
}

export type ReviewStats = {
	total: number;
	avgRating: number | null;
	ratingDistribution: Record<number, number>;
	dateRange: { earliest: string | null; latest: string | null };
};

/** Extract a numeric rating from a review record, trying common field names. */
function extractRating(review: Record<string, unknown>): number | null {
	const raw = coalesce(review, "rating", "review_rating", "stars", "score");
	if (raw == null) return null;

	const n = Number(raw);
	return Number.isFinite(n) ? n : null;
}

/** Extract a date string from a review record, trying common field names. */
function extractDate(review: Record<string, unknown>): string | null {
	const raw = coalesce(review, "date", "review_date", "timestamp");
	return raw != null ? String(raw) : null;
}

/** Compute aggregate stats across all reviews. */
export function computeReviewStats(
	reviews: Record<string, unknown>[],
): ReviewStats {
	const distribution: Record<number, number> = {};
	let ratingSum = 0;
	let ratingCount = 0;
	let earliest: string | null = null;
	let latest: string | null = null;

	for (const review of reviews) {
		const rating = extractRating(review);
		if (rating != null) {
			const bucket = Math.round(rating);
			distribution[bucket] = (distribution[bucket] ?? 0) + 1;
			ratingSum += rating;
			ratingCount++;
		}

		const date = extractDate(review);
		if (date) {
			if (!earliest || date < earliest) earliest = date;
			if (!latest || date > latest) latest = date;
		}
	}

	return {
		total: reviews.length,
		avgRating: ratingCount > 0 ? ratingSum / ratingCount : null,
		ratingDistribution: distribution,
		dateRange: { earliest, latest },
	};
}

/** Format rating distribution as a visual bar chart. */
export function formatRatingDistribution(stats: ReviewStats): string {
	const lines: string[] = [];
	const maxCount = Math.max(...Object.values(stats.ratingDistribution), 1);

	for (let star = 5; star >= 1; star--) {
		const count = stats.ratingDistribution[star] ?? 0;
		const pct =
			stats.total > 0 ? ((count / stats.total) * 100).toFixed(1) : "0.0";
		const barLen = Math.round((count / maxCount) * 16);
		const bar = "\u2588".repeat(barLen);
		const stars = "\u2B50".repeat(star);
		lines.push(`${stars} ${count} (${pct}%) ${bar}`);
	}

	if (stats.avgRating != null) {
		lines.push(`**Average:** ${stats.avgRating.toFixed(2)}/5`);
	}

	return lines.join("\n");
}

/** Format a single review as a compact one-liner. */
export function formatReviewLine(
	index: number,
	review: Record<string, unknown>,
	extraFields?: (review: Record<string, unknown>) => string,
): string {
	const rating = extractRating(review);
	const stars = rating != null ? "\u2B50".repeat(Math.round(rating)) : "N/A";

	const text = coalesce(review, "review_text", "text", "content", "body");
	const snippet = text
		? String(text).slice(0, 120).replace(/\n/g, " ") +
			(String(text).length > 120 ? "..." : "")
		: "No text";

	const reviewer = coalesce(review, "reviewer", "author", "user_name");
	const date = extractDate(review);

	const parts = [`**[${index}]** ${stars} — "${snippet}"`];
	if (reviewer) parts.push(`— ${reviewer}`);
	if (date) parts.push(String(date));

	let line = parts.join(", ");

	const extras = extraFields?.(review);
	if (extras) line += `\n${extras}`;

	return line;
}
