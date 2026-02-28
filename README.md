# Review Intel

An [OpenClaw](https://github.com/openclaw/openclaw) plugin that adds product review intelligence tools powered by the BrightData Web Scraper API. Scan app reviews from Google Play and Apple App Store, and product reviews from G2 and Trustpilot without getting blocked by anti-bot protections.

## What It Does

Registers two tools that let your agent extract **bulk structured review data** from app stores and review platforms:

- **`app_reviews`** — Scan app reviews from Google Play or Apple App Store. Returns all available reviews with aggregate stats (rating distribution, averages), plus individual review text, ratings, dates, reviewer info, helpful votes, and app version.
- **`product_reviews`** — Scan product reviews from G2 or Trustpilot. Returns all available reviews with aggregate stats, plus review text, ratings, pros/cons, reviewer info, and dates. For G2, can also fetch a product overview (overall rating, categories, alternatives).

All requests go through BrightData's Web Scraper API, which handles anti-bot bypass, rate limiting, and data extraction.

## How It Works

### Invocation

The main agent or research agent delegates to a dedicated review-intel sub-agent when a user asks about product/app reviews. The sub-agent calls the appropriate tool with the review page URL.

### Execution flow

1. **Platform detection** — `executePlatformScrape()` auto-detects the platform from the URL (e.g. `g2.com` → G2) or uses an explicit `platform` param.

2. **Parameter sanitization** — An **allowlist** per dataset controls exactly which params get forwarded to BrightData. Anything else (hallucinated params, unsupported fields) is silently dropped. This prevents 400 errors from the API.

   | Dataset | Accepted params |
   |---------|----------------|
   | G2 | `pages`, `start_date`, `end_date`, `sort_by` |
   | Trustpilot | `start_date`, `end_date`, `sort_by` |
   | Google Play | `num_of_reviews`, `start_date`, `end_date`, `sort_by`, `min_rating`, `max_rating` |
   | Apple App Store | `num_of_reviews`, `start_date`, `end_date`, `sort_by`, `min_rating`, `max_rating` |

3. **Platform defaults** — Before user params are applied, defaults maximize review collection:
   - G2: `pages: 50` (~500 reviews at ~10/page)
   - Google Play / App Store: `num_of_reviews: 500`
   - Trustpilot: no count param; BrightData returns what it gets

   User-provided values override these defaults.

4. **BrightData API call** — `client.scrapeSync()` posts to the BrightData datasets API. If it returns 200, results come back immediately. If 202 (async), it polls with exponential backoff until the snapshot is ready (up to `timeoutMs`, default 120s).

5. **Bulk results** — The full results array is returned (not just the first record).

6. **Aggregate stats** — `computeReviewStats()` scans all reviews and produces:
   - Total count
   - Average rating (tries fields: `rating`, `review_rating`, `stars`, `score`)
   - Rating distribution (1-5 star buckets)
   - Date range (earliest / latest)

7. **Formatted output** — The tool returns markdown content with:
   - Header: platform, URL, review count
   - Visual rating distribution bar chart
   - Each review as a compact line: `**[1]** ⭐⭐⭐⭐⭐ — "snippet..." — reviewer, date`
   - Product reviews include pros/cons; app reviews include helpful votes and app version
   - `details` object contains `{ platform, stats, reviews }` with all raw data

### Self-healing & error recovery

The tools include two layers of automatic retry:

**Transport layer (429 rate limits)** — `client.ts` retries once on 429, reading the `Retry-After` header (fallback 5s, capped at 15s). This applies to all API calls including G2 overview fetches.

**Param layer (400 validation errors)** — `shared.ts` catches validation errors, parses which fields BrightData rejected, strips them from the input, and retries once. This is a safety net behind the allowlist — if a field somehow gets through the allowlist but BrightData still rejects it, the retry auto-heals.

**Collection tracking** — Every successful response includes `metadata` in the `details` return:
- `requested`: what was asked for (`numOfReviews`, `pages`, `platform`)
- `received`: what came back (`count`, `dateRange`)
- `warnings`: under-collection alerts (e.g. "Requested 500 reviews but received 100")
- `retried` / `strippedFields`: whether a validation retry happened and which fields were dropped

**Actionable errors** — When retries are exhausted, errors include concrete next steps (simplify params, wait and retry, fall back to browser).

### Fallback strategy

If BrightData fails (API error, timeout, empty results):

1. **review-intel tools** (primary) — Structured data, fastest path. Self-healing handles most transient errors automatically.
2. **browser agent** (fallback) — Playwright visits the review page directly and extracts from the rendered DOM. Review pages are JS-heavy; the browser handles this well.
3. **web fetch** (last resort) — Unreliable since review pages are JS-rendered and web fetch gets incomplete data. Only use if browser is also unavailable.

## Use Cases

### Competitive analysis

> "Pull all G2 reviews for Slack and Notion, compare their strengths and weaknesses."

The agent fetches reviews from both products, computes aggregate stats, and synthesizes a side-by-side comparison — rating distributions, most-mentioned pros/cons, and common complaints.

### App store monitoring

> "Get the latest 200 Google Play reviews for our app and flag anything about crashes or slow performance."

Fetches recent reviews filtered by date, then scans the text for negative themes. Useful for QA teams tracking post-release regressions.

### Market research

> "What do Trustpilot reviewers say about Acme Corp's customer support?"

Pulls all available Trustpilot reviews and surfaces support-related themes — response times, resolution quality, and recurring complaints.

### Feature gap discovery

> "Scan G2 reviews for Figma and identify the most-requested missing features."

Fetches bulk reviews with pros/cons structured data, then aggregates feature requests and unmet needs across hundreds of reviews.

### Sentiment tracking over time

> "Compare App Store reviews for our app from Q3 vs Q4 last year."

Two calls with `start_date` / `end_date` filters. The agent compares rating distributions and recurring themes across time periods to identify trends.

### Pre-sales intelligence

> "Pull the G2 overview and recent reviews for Datadog. Include the product overview."

Uses `include_overview: true` to get Datadog's G2 profile (overall rating, review count, categories, alternatives) alongside individual reviews — a quick competitive snapshot.

### Multi-platform audit

> "Get reviews for Zoom from both G2 and the Apple App Store."

The agent makes two tool calls — `product_reviews` for G2 and `app_reviews` for the App Store — and combines the results into a unified analysis across platforms.

## Installation

Clone into your skills directory:

```bash
# Workspace-level (this agent only)
git clone https://github.com/antonioiliev/skill-review-intel.git ./skills/review-intel

# User-level (shared across all agents)
git clone https://github.com/antonioiliev/skill-review-intel.git ~/.openclaw/skills/review-intel
```

Then add the plugin config to your `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "review-intel": {
        "enabled": true,
        "config": {
          "apiKey": "${BRIGHTDATA_API_KEY}"
        }
      }
    }
  }
}
```

Agents that need these tools also need `tools.alsoAllow`:

```json
{
  "agents": {
    "list": [
      {
        "id": "review-intel",
        "skills": ["review-intel"],
        "tools": { "alsoAllow": ["review-intel"] }
      }
    ]
  }
}
```

## Configuration

| Key | Required | Description |
|-----|----------|-------------|
| `apiKey` | Yes | BrightData API key. Supports `${ENV_VAR}` syntax. |
| `timeoutMs` | No | Request timeout in milliseconds (default: 120000). Review scrapes tend to be slower, so the default is higher than other plugins. |
| `datasetOverrides` | No | Override default BrightData dataset IDs per platform/type (e.g. `{ "g2_reviews": "gd_custom_id" }`). |

## Supported Platforms

| Platform | Dataset Key | Dataset ID | Type |
|----------|-------------|-----------|------|
| Google Play | `google_play_reviews` | `gd_m6zagkt024uwvvwuyu` | App reviews |
| Apple App Store | `apple_appstore_reviews` | `gd_lsk9ki3u2iishmwrui` | App reviews |
| G2 | `g2_reviews` | `gd_l88xvdka1uao86xvlb` | Product reviews |
| G2 | `g2_overview` | `gd_l88xp4k01qnhvyqlvw` | Product overview |
| Trustpilot | `trustpilot_reviews` | `gd_lm5zmhwd2sni130p` | Product reviews |

Platform is auto-detected from the URL. You can override detection with the `platform` parameter.

## Filter Parameters

Parameters vary by platform. Unsupported params are silently dropped at runtime.

### app_reviews (Google Play, Apple App Store)

| Parameter | Type | Description |
|-----------|------|-------------|
| `num_of_reviews` | number | Max reviews to collect (default: 500) |
| `start_date` | string | From date (MM-DD-YYYY) |
| `end_date` | string | Until date (MM-DD-YYYY) |
| `sort_by` | string | Sort order (`most_relevant`, `newest`) |
| `min_rating` | number | Min star rating (1-5) |
| `max_rating` | number | Max star rating (1-5) |

### product_reviews (G2, Trustpilot)

| Parameter | Type | Description |
|-----------|------|-------------|
| `pages` | number | (G2 only) Review pages to scrape, ~10 reviews/page (default: 50) |
| `start_date` | string | From date (MM-DD-YYYY) |
| `end_date` | string | Until date (MM-DD-YYYY) |
| `sort_by` | string | Sort order for reviews |
| `include_overview` | boolean | (G2 only) Also fetch product overview |

> `num_of_reviews`, `min_rating`, and `max_rating` are **not supported** for G2 or Trustpilot — BrightData rejects them.

## Agent Delegation Pattern

This plugin works best with a dedicated `review-intel` sub-agent:

- **review-intel agent** — Has the tools directly. Receives a task with URLs and data requirements, calls the appropriate tool, returns structured results with aggregate stats.
- **main / research agents** — Delegate review intelligence tasks to the review-intel sub-agent. If review-intel fails, they should fall back to the browser agent, then web fetch as a last resort.

## Requirements

- A [BrightData](https://brightdata.com) account with Web Scraper API access
- Active datasets for the platforms you want to scrape (dataset IDs are account-specific)

## License

MIT
