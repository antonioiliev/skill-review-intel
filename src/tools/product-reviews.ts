import { Type } from "@sinclair/typebox";
import { optionalStringEnum } from "openclaw/plugin-sdk";
import type { BrightDataClient } from "../client.js";
import { executePlatformScrape, coalesce } from "./shared.js";

const PRODUCT_PLATFORMS = ["g2", "trustpilot"] as const;

export function createProductReviewsTool(client: BrightDataClient) {
	return {
		name: "product_reviews",
		label: "Product Reviews",
		description:
			"Scan product reviews from G2 or Trustpilot. Returns review text, ratings, pros/cons, reviewer info, and dates. For G2, can also fetch product overview (overall rating, categories, alternatives).",
		parameters: Type.Object({
			url: Type.String({
				description:
					"Product page URL on G2 (g2.com) or Trustpilot (trustpilot.com)",
			}),
			platform: optionalStringEnum(PRODUCT_PLATFORMS, {
				description:
					"Platform override: g2 or trustpilot. Auto-detected from URL if omitted.",
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
					description: "Sort order for reviews.",
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
			include_overview: Type.Optional(
				Type.Boolean({
					description:
						"(G2 only) Also fetch the product overview — overall rating, review count, categories, and alternatives.",
				}),
			),
		}),

		async execute(_toolCallId: string, params: Record<string, unknown>) {
			// Strip include_overview from params before passing to scrape
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

			const { platform, result: review, url } = scraped;
			const lines: string[] = [];

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

			lines.push(formatProductReviewSummary(platform, review, url));

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: { platform, review },
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

function formatProductReviewSummary(
	platform: string,
	review: Record<string, unknown>,
	url: string,
): string {
	const lines: string[] = [
		`## Product Review Scan`,
		`**Platform:** ${platform}`,
		`**URL:** ${url}`,
	];

	const productName = coalesce(
		review,
		"product_name",
		"name",
		"title",
		"company_name",
	);
	if (productName) lines.push(`**Product:** ${productName}`);

	const overallRating = coalesce(review, "rating", "overall_rating", "score");
	if (overallRating != null)
		lines.push(`**Overall Rating:** ${overallRating}`);

	const reviewText = coalesce(
		review,
		"review_text",
		"text",
		"content",
		"body",
	);
	if (reviewText) lines.push(`\n**Review:**\n${reviewText}`);

	const reviewer = coalesce(review, "reviewer", "author", "user_name");
	if (reviewer) lines.push(`**Reviewer:** ${reviewer}`);

	const pros = coalesce(review, "pros", "likes", "what_i_like");
	if (pros) lines.push(`**Pros:** ${pros}`);

	const cons = coalesce(review, "cons", "dislikes", "what_i_dislike");
	if (cons) lines.push(`**Cons:** ${cons}`);

	const reviewRating = coalesce(review, "review_rating", "stars");
	if (reviewRating != null)
		lines.push(`**Review Rating:** ${reviewRating}/5`);

	const date = coalesce(review, "date", "review_date", "timestamp");
	if (date) lines.push(`**Date:** ${date}`);

	return lines.join("\n");
}
