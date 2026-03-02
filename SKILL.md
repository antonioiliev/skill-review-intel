---
name: review-intel
description: "Product review intelligence: scan Google Play reviews, Apple App Store reviews, G2 reviews, Trustpilot reviews. Triggers on: 'app reviews', 'google play', 'app store reviews', 'g2', 'trustpilot', 'product reviews', 'review scan', 'competitor reviews'."
---

# Review Intel Skill

Product review intelligence tools powered by the BrightData Web Scraper API. Scan app reviews from Google Play and Apple App Store, and product reviews from G2 and Trustpilot.

Tools return **all available reviews** (up to platform limits) with aggregate statistics — rating distribution, average rating, date range — plus individual review data for comprehensive analysis.

## Tools

### app_reviews

Scan app reviews from Google Play or Apple App Store. Returns bulk reviews with aggregate stats.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | App URL on Google Play or Apple App Store |
| `platform` | string | No | Override: `google_play` or `apple_appstore`. Auto-detected from URL. |
| `num_of_reviews` | number | No | Maximum number of reviews to collect. Default: 500. |
| `start_date` | string | No | Filter from date (MM-DD-YYYY) |
| `end_date` | string | No | Filter until date (MM-DD-YYYY) |
| `sort_by` | string | No | Sort order: `most_relevant`, `newest` |
| `min_rating` | number | No | Minimum star rating (1-5) |
| `max_rating` | number | No | Maximum star rating (1-5) |

**Example URLs:**
- Google Play: `https://play.google.com/store/apps/details?id=com.example.app`
- Apple App Store: `https://apps.apple.com/us/app/example/id123456789`

**Returns:** Aggregate stats (rating distribution, average, date range) + all individual reviews with: review text, reviewer, rating, date, helpful votes, app version.

### product_reviews

Scan product reviews from G2 or Trustpilot. Returns bulk reviews with aggregate stats.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | Product page URL on G2 or Trustpilot |
| `platform` | string | No | Override: `g2` or `trustpilot`. Auto-detected from URL. |
| `pages` | number | No | (G2 only) Number of review pages to scrape. ~10 reviews/page. Default: 50. |
| `start_date` | string | No | Filter from date (MM-DD-YYYY) |
| `end_date` | string | No | Filter until date (MM-DD-YYYY) |
| `sort_by` | string | No | Sort order for reviews |
| `include_overview` | boolean | No | (G2 only) Also fetch product overview: overall rating, review count, categories, alternatives |

> **Note:** `num_of_reviews`, `min_rating`, and `max_rating` are not supported for G2 or Trustpilot (BrightData rejects them). For G2, use `pages` to control volume. For Trustpilot, BrightData returns all available reviews automatically. Unsupported params are silently dropped at runtime.

**Example URLs:**
- G2: `https://www.g2.com/products/slack/reviews`
- Trustpilot: `https://www.trustpilot.com/review/example.com`

**Returns:** Aggregate stats (rating distribution, average, date range) + all individual reviews with: product name, review text, reviewer, pros/cons, rating, date.

## Self-Healing & Error Recovery

The tools automatically handle common BrightData API failures:

### Auto-retry on validation errors (400)
If BrightData rejects specific fields, the tool parses which fields were rejected, strips them from the request, and retries once. Stripped fields appear as warnings in the output `### Notices` section.

### Rate limit retry (429)
On a 429 response, the tool reads the `Retry-After` header (fallback 5s, capped at 15s), waits, and retries once automatically. This is transparent — the caller sees either successful results or an actionable error.

### Collection progress tracking
Every response includes `metadata` in the `details` object with:
- **requested** — what was asked for (num_of_reviews, pages, platform)
- **received** — what came back (count, date range)
- **warnings** — under-collection alerts (e.g. "Requested 500 reviews but received 100")
- **retried** / **strippedFields** — whether a validation retry happened and which fields were dropped

### Actionable error messages
When retries are exhausted, error messages include concrete next steps:
- 429: "Wait 30-60s and retry", "Reduce reviews/pages", "Fall back to browser"
- 400: "Simplify request: use only url", "Fall back to browser"
- Timeout: "Retry with fewer reviews", "Fall back to browser"

## Fallback Strategy

If BrightData scraping fails (API error, timeout, empty results), follow this fallback chain:

1. **review-intel tools** (primary) — Use `app_reviews` or `product_reviews`. Fastest, returns structured data with aggregate stats. Self-healing handles most transient errors automatically.
2. **browser agent** (fallback) — Delegate to the **browser** sub-agent to visit the review page directly and extract reviews from the rendered page. Review pages are JS-heavy; the browser handles this well.
3. **web fetch** (last resort) — Use the research agent's web fetch. This is unreliable for review pages since most are JS-rendered and web fetch gets incomplete/no review data. Only use if browser is also unavailable.

## Analysis Guidance

The tools return raw structured review data with aggregate stats. The agent consuming this data should:

- **Identify themes:** Group reviews by recurring topics (e.g., "support", "pricing", "ease of use")
- **Extract pros/cons patterns:** Look across all reviews for the most commonly mentioned positives and negatives
- **Spot opportunities:** Identify unmet needs or feature requests that appear frequently
- **Note rating trends:** Use the rating distribution to understand overall sentiment shape (bimodal? skewed positive?)
- **Flag outliers:** Extremely negative reviews with specific complaints may indicate critical issues
- **Compare time periods:** If date range spans months, note whether sentiment is improving or declining

### Citing evidence (important)

Every claim in the analysis **must** be backed by specific reviews. When stating a theme, pattern, or finding:

- **Reference reviews by index** (e.g., "Users report slow onboarding [3, 7, 15]") so claims are verifiable
- **Quote key phrases** from the review text that illustrate the point — short, direct quotes, not paraphrased
- **Quantify** where possible: "8 of 42 reviews mention poor customer support" is stronger than "some users complain about support"
- **Don't make unsupported claims** — if only 1 review mentions something, say so; don't generalize from a single data point

The goal is a thorough, evidence-based analysis where every finding can be traced back to the actual review data. Think of reviews as primary sources — cite them.

## Common Use Cases

These patterns show how to handle typical user requests. Match the user's intent to a pattern, call the right tool(s), then analyze the results as described.

### Competitive analysis

**User asks:** "Compare reviews for Slack vs Notion on G2" / "How does X stack up against Y?"

**Approach:**
1. Call `product_reviews` for each product URL (can run in parallel if delegating to separate sub-agents).
2. Use `include_overview: true` on G2 to get overall ratings and categories.
3. Compare rating distributions, recurring pros/cons themes, and common complaints side by side.
4. Highlight where one product is consistently praised and the other criticized.

### App store monitoring

**User asks:** "Check recent reviews for our app" / "Are users reporting crashes after the latest release?"

**Approach:**
1. Call `app_reviews` with `sort_by: "newest"` and optionally `start_date` to scope to a release window.
2. Scan review text for the user's keywords (crashes, bugs, performance, etc.).
3. Report the rating distribution for the filtered period and flag negative trends.

### Market research

**User asks:** "What do customers think about Acme Corp?" / "Summarize Trustpilot reviews for this company"

**Approach:**
1. Call `product_reviews` with the Trustpilot or G2 URL.
2. Group reviews by recurring topics (support, pricing, onboarding, reliability).
3. Quantify each theme — how many reviews mention it, what's the average sentiment.
4. Surface the most impactful positives and negatives.

### Feature gap discovery

**User asks:** "What features are users asking for?" / "Find unmet needs in reviews"

**Approach:**
1. Call `product_reviews` or `app_reviews` to get bulk reviews.
2. Look for patterns in negative reviews and low ratings — recurring feature requests, "I wish it had...", missing functionality.
3. Aggregate by frequency and present the top gaps with representative quotes.

### Sentiment tracking over time

**User asks:** "Has sentiment improved since Q3?" / "Compare reviews before and after the redesign"

**Approach:**
1. Make two tool calls with different `start_date` / `end_date` ranges.
2. Compare rating distributions, average ratings, and theme frequencies across the two periods.
3. Note whether specific complaints increased or decreased.

### Pre-sales / product intelligence

**User asks:** "Give me a quick overview of Datadog on G2" / "What's the market perception of this product?"

**Approach:**
1. Call `product_reviews` with `include_overview: true` for G2.
2. Lead with the overview data (overall rating, review count, categories, alternatives).
3. Follow with themes from recent reviews to add qualitative depth.

### Multi-platform audit

**User asks:** "Get reviews for Zoom from G2 and the App Store" / "What do people say about X across platforms?"

**Approach:**
1. Call `product_reviews` for G2/Trustpilot and `app_reviews` for Google Play/App Store.
2. Note that different platforms attract different reviewer types (B2B on G2, consumers on app stores).
3. Synthesize findings across platforms, highlighting where feedback converges or diverges.

## Agent Roles

### review-intel agent (direct tool usage)
The dedicated review-intel agent uses `app_reviews` and `product_reviews` tools directly.

### main / research agents (delegation)
These agents delegate to the **review-intel** sub-agent when users ask about app reviews, product reviews, or competitor sentiment.

## When NOT to Use

- Simple web page fetching — use `web_fetch` directly
- Social media scanning — use the **social-media** agent instead
- Sites that aren't review platforms — use standard HTTP tools

## Dataset Reference

| Dataset Key | Dataset ID | Platform | Type |
|-------------|-----------|----------|------|
| `google_play_reviews` | `gd_m6zagkt024uwvvwuyu` | Google Play | App reviews |
| `apple_appstore_reviews` | `gd_lsk9ki3u2iishmwrui` | Apple App Store | App reviews |
| `g2_reviews` | `gd_l88xvdka1uao86xvlb` | G2 | Product reviews |
| `g2_overview` | `gd_l88xp4k01qnhvyqlvw` | G2 | Product overview |
| `trustpilot_reviews` | `gd_lm5zmhwd2sni130p` | Trustpilot | Product reviews |

### Filter parameter summary

| Parameter | Type | Platforms | Description |
|-----------|------|-----------|-------------|
| `num_of_reviews` | number | Google Play, Apple App Store | Max reviews to collect (default: 500) |
| `pages` | number | G2 | Number of review pages (~10 reviews/page, default: 50) |
| `start_date` | string | All | From date (MM-DD-YYYY) |
| `end_date` | string | All | Until date (MM-DD-YYYY) |
| `sort_by` | string | All | Sort order (`most_relevant`, `newest`) |
| `min_rating` | number | Google Play, Apple App Store | Min star rating (1-5) |
| `max_rating` | number | Google Play, Apple App Store | Max star rating (1-5) |
| `include_overview` | boolean | G2 | Also fetch product overview |
