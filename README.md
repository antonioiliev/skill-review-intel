# Review Intel

An [OpenClaw](https://github.com/openclaw/openclaw) plugin that adds product review intelligence tools powered by the BrightData Web Scraper API. Scan app reviews from Google Play and Apple App Store, and product reviews from G2 and Trustpilot without getting blocked by anti-bot protections.

## What It Does

Registers two tools that let your agent extract structured review data from app stores and review platforms:

- **`app_reviews`** — Scan app reviews from Google Play or Apple App Store. Returns review text, ratings, dates, reviewer info, and helpful votes.
- **`product_reviews`** — Scan product reviews from G2 or Trustpilot. Returns review text, ratings, pros/cons, reviewer info, and dates. For G2, can also fetch a product overview (overall rating, categories, alternatives).

All requests go through BrightData's Web Scraper API, which handles anti-bot bypass, rate limiting, and data extraction.

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

Both tools support these optional filter parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `num_of_reviews` | number | Max reviews to collect |
| `start_date` | string | From date (MM-DD-YYYY) |
| `end_date` | string | Until date (MM-DD-YYYY) |
| `sort_by` | string | Sort order (`most_relevant`, `newest`) |
| `min_rating` | number | Min star rating (1-5) |
| `max_rating` | number | Max star rating (1-5) |
| `include_overview` | boolean | G2 only: also fetch product overview |

## Agent Delegation Pattern

This plugin works best with a dedicated `review-intel` sub-agent:

- **review-intel agent** — Has the tools directly. Receives a task with URLs and data requirements, calls the appropriate tool, returns structured results.
- **main / research agents** — Delegate review intelligence tasks to the review-intel sub-agent.

## Requirements

- A [BrightData](https://brightdata.com) account with Web Scraper API access
- Active datasets for the platforms you want to scrape (dataset IDs are account-specific)

## License

MIT
