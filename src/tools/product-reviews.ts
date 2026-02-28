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

const PRODUCT_PLATFORMS = ["g2", "trustpilot"] as const;

export function createProductReviewsTool(client: BrightDataClient) {
	return {
		name: "product_reviews",
		label: "Product Reviews",
		description:
			"Scan product reviews from G2 or Trustpilot. Returns all available reviews with aggregate stats (rating distribution, averages), plus individual review text, ratings, pros/cons, reviewer info, and dates.",
		parameters: Type.Object({
			url: Type.String({
				description:
					"Product page URL on G2 (g2.com) or Trustpilot (trustpilot.com)",
			}),
			platform: optionalStringEnum(PRODUCT_PLATFORMS, {
				description:
					"Platform override: g2 or trustpilot. Auto-detected from URL if omitted.",
			}),
			pages: Type.Optional(
				Type.Number({
					description:
						"(G2 only) Number of review pages to scrape. ~10 reviews per page. Default: 50.",
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
					description: "Sort order for reviews.",
				}),
			),
			include_overview: Type.Optional(
				Type.Boolean({
					description:
						"(G2 only) Also fetch the product overview — overall rating, review count, categories, and alternatives.",
				}),
			),
		}),

		async execute(_toolCallId: string, params: Record<string, unknown>) {
			const { include_overview, ...scrapeParams } = params as Record<
				string,
				unknown
			> & { include_overview?: boolean };

			const scraped = await executePlatformScrape(
				client,
				scrapeParams,
				PRODUCT_PLATFORMS,
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

			// Fetch G2 overview if requested
			if (include_overview && platform === "g2") {
				try {
					const overviewResults = await client.scrapeSync(
						"g2_overview",
						[{ url }],
					);
					if (overviewResults.length) {
						lines.push(
							formatG2Overview(overviewResults[0] ?? {}, url),
						);
						lines.push("");
					}
				} catch {
					lines.push("*Could not fetch G2 product overview.*\n");
				}
			}

			lines.push(`## Product Review Analysis`);
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
						const pros = coalesce(r, "pros", "likes", "what_i_like");
						if (pros) extras.push(`Pros: ${String(pros).slice(0, 200)}`);
						const cons = coalesce(r, "cons", "dislikes", "what_i_dislike");
						if (cons) extras.push(`Cons: ${String(cons).slice(0, 200)}`);
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

function formatG2Overview(
	overview: Record<string, unknown>,
	url: string,
): string {
	const lines: string[] = [`## G2 Product Overview`, `**URL:** ${url}`];

	const name = coalesce(overview, "product_name", "name", "title");
	if (name) lines.push(`**Product:** ${name}`);

	const rating = coalesce(overview, "rating", "overall_rating", "score");
	if (rating != null) lines.push(`**Overall Rating:** ${rating}`);

	const reviewCount = coalesce(
		overview,
		"review_count",
		"total_reviews",
		"num_reviews",
	);
	if (reviewCount != null) lines.push(`**Total Reviews:** ${reviewCount}`);

	const categories = coalesce(overview, "categories", "category");
	if (categories) {
		const cats = Array.isArray(categories)
			? categories.join(", ")
			: String(categories);
		lines.push(`**Categories:** ${cats}`);
	}

	const alternatives = coalesce(overview, "alternatives", "competitors");
	if (Array.isArray(alternatives) && alternatives.length > 0) {
		lines.push(`**Alternatives:** ${alternatives.join(", ")}`);
	}

	const description = coalesce(overview, "description", "about");
	if (description) lines.push(`\n**Description:**\n${description}`);

	return lines.join("\n");
}
