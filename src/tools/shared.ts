import type { BrightDataClient, ScrapeResult } from "../client.js";
import { detectPlatform } from "../types.js";

/**
 * Shared execute flow for platform-based scrape tools.
 * Returns the detected platform and first result, or null if no data.
 */
export async function executePlatformScrape(
	client: BrightDataClient,
	params: Record<string, unknown>,
	allowedPlatforms: readonly string[],
	datasetSuffix: string,
): Promise<{
	platform: string;
	result: Record<string, unknown>;
	url: string;
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

	// Pass through filter params (start_date, end_date, num_of_reviews, etc.)
	const input: Record<string, unknown> = { url };
	for (const [key, value] of Object.entries(params)) {
		if (key !== "url" && key !== "platform" && value != null) {
			input[key] = value;
		}
	}

	const results: ScrapeResult = await client.scrapeSync(datasetKey, [input]);

	if (!results.length) return null;

	return { platform, result: results[0] ?? {}, url };
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
