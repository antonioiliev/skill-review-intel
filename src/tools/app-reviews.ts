import { Type } from "@sinclair/typebox";
import { optionalStringEnum } from "openclaw/plugin-sdk";
import type { BrightDataClient } from "../client.js";
import { executePlatformScrape, coalesce } from "./shared.js";

const APP_PLATFORMS = ["google_play", "apple_appstore"] as const;

export function createAppReviewsTool(client: BrightDataClient) {
	return {
		name: "app_reviews",
		label: "App Reviews",
		description:
			"Scan app reviews from Google Play or Apple App Store. Returns review text, ratings, dates, reviewer info, and helpful votes.",
		parameters: Type.Object({
			url: Type.String({
				description:
					"App URL on Google Play (play.google.com) or Apple App Store (apps.apple.com)",
			}),
			platform: optionalStringEnum(APP_PLATFORMS, {
				description:
					"Platform override: google_play or apple_appstore. Auto-detected from URL if omitted.",
			}),
			num_of_reviews: Type.Optional(
				Type.Number({
					description: "Maximum number of reviews to collect.",
				}),
			),
			start_date: Type.Optional(
				Type.String({
					description:
						"Filter reviews from this date (MM-DD-YYYY format).",
				}),
			),
			end_date: Type.Optional(
				Type.String({
					description:
						"Filter reviews until this date (MM-DD-YYYY format).",
				}),
			),
			sort_by: Type.Optional(
				Type.String({
					description:
						"Sort order for reviews, e.g. 'most_relevant', 'newest'.",
				}),
			),
			min_rating: Type.Optional(
				Type.Number({
					description: "Minimum star rating filter (1-5).",
				}),
			),
			max_rating: Type.Optional(
				Type.Number({
					description: "Maximum star rating filter (1-5).",
				}),
			),
		}),

		async execute(_toolCallId: string, params: Record<string, unknown>) {
			const scraped = await executePlatformScrape(
				client,
				params,
				APP_PLATFORMS,
				"reviews",
			);

			if (!scraped) {
				const url = String(params.url ?? "").trim();
				return {
					content: [
						{
							type: "text" as const,
							text: `No review data returned for ${url}`,
						},
					],
				};
			}

			const { platform, result: review, url } = scraped;
			const summary = formatAppReviewSummary(platform, review, url);

			return {
				content: [{ type: "text" as const, text: summary }],
				details: { platform, review },
			};
		},
	};
}

function formatAppReviewSummary(
	platform: string,
	review: Record<string, unknown>,
	url: string,
): string {
	const lines: string[] = [
		`## App Review Scan`,
		`**Platform:** ${platform}`,
		`**URL:** ${url}`,
	];

	const appName = coalesce(review, "app_name", "name", "title");
	if (appName) lines.push(`**App:** ${appName}`);

	const overallRating = coalesce(review, "rating", "overall_rating", "score");
	if (overallRating != null) lines.push(`**Overall Rating:** ${overallRating}`);

	const reviewText = coalesce(review, "review_text", "text", "content", "body");
	if (reviewText) lines.push(`\n**Review:**\n${reviewText}`);

	const reviewer = coalesce(review, "reviewer", "author", "user_name");
	if (reviewer) lines.push(`**Reviewer:** ${reviewer}`);

	const reviewRating = coalesce(review, "review_rating", "stars");
	if (reviewRating != null) lines.push(`**Review Rating:** ${reviewRating}/5`);

	const date = coalesce(review, "date", "review_date", "timestamp");
	if (date) lines.push(`**Date:** ${date}`);

	const helpful = coalesce(review, "helpful_count", "helpful_votes", "thumbs_up");
	if (helpful != null) lines.push(`**Helpful Votes:** ${helpful}`);

	const version = coalesce(review, "app_version", "version");
	if (version) lines.push(`**App Version:** ${version}`);

	return lines.join("\n");
}
