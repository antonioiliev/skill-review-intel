import { Type } from "@sinclair/typebox";
import { optionalStringEnum } from "openclaw/plugin-sdk";
import type { BrightDataClient } from "../client.js";
import {
	executePlatformScrape,
	coalesce,
	computeReviewStats,
	formatRatingDistribution,
	formatReviewLine,
} from "./shared.js";

const APP_PLATFORMS = ["google_play", "apple_appstore"] as const;

export function createAppReviewsTool(client: BrightDataClient) {
	return {
		name: "app_reviews",
		label: "App Reviews",
		description:
			"Scan app reviews from Google Play or Apple App Store. Returns all available reviews with aggregate stats (rating distribution, averages), plus individual review text, ratings, dates, reviewer info, helpful votes, and app version.",
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
					description:
						"Maximum number of reviews to collect. Default: 500.",
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

			const { platform, results: reviews, url, metadata } = scraped;
			const stats = computeReviewStats(reviews);
			const lines: string[] = [];

			// Surface warnings and collection metadata as notices
			if (metadata.warnings.length > 0) {
				lines.push("### Notices");
				for (const warning of metadata.warnings) {
					lines.push(`- ${warning}`);
				}
				lines.push("");
			}

			lines.push(`## App Review Analysis`);
			lines.push(`**Platform:** ${platform} | **URL:** ${url}`);
			lines.push(`**Reviews Collected:** ${stats.total}`);

			// Collection summary
			if (metadata.received.dateRange.earliest && metadata.received.dateRange.latest) {
				lines.push(
					`**Date Range:** ${metadata.received.dateRange.earliest} to ${metadata.received.dateRange.latest}`,
				);
			}
			if (metadata.retried) {
				lines.push(
					`**Note:** Auto-retried after stripping unsupported fields: ${metadata.strippedFields.join(", ")}`,
				);
			}
			lines.push("");

			lines.push("### Rating Distribution");
			lines.push(formatRatingDistribution(stats));
			lines.push("");

			lines.push(`### Reviews (${stats.total} total)`);
			lines.push("");

			for (let i = 0; i < reviews.length; i++) {
				const review = reviews[i]!;
				lines.push(
					formatReviewLine(i + 1, review, (r) => {
						const extras: string[] = [];
						const helpful = coalesce(r, "helpful_count", "found_helpful", "helpful_votes", "thumbs_up");
						if (helpful != null) extras.push(`Helpful: ${helpful}`);
						const version = coalesce(r, "app_version", "version");
						if (version) extras.push(`Version: ${version}`);
						return extras.length > 0 ? extras.join(" | ") : "";
					}),
				);
			}

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: { platform, stats, reviews, metadata },
			};
		},
	};
}
