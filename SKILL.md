---
name: review-intel
description: "Product review intelligence: scan Google Play reviews, Apple App Store reviews, G2 reviews, Trustpilot reviews. Triggers on: 'app reviews', 'google play', 'app store reviews', 'g2', 'trustpilot', 'product reviews', 'review scan', 'competitor reviews'."
---

# Review Intel Skill

Product review intelligence tools powered by the BrightData Web Scraper API. Scan app reviews from Google Play and Apple App Store, and product reviews from G2 and Trustpilot.

## Tools

### app_reviews

Scan app reviews from Google Play or Apple App Store.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | App URL on Google Play or Apple App Store |
| `platform` | string | No | Override: `google_play` or `apple_appstore`. Auto-detected from URL. |
| `num_of_reviews` | number | No | Maximum number of reviews to collect |
| `start_date` | string | No | Filter from date (MM-DD-YYYY) |
| `end_date` | string | No | Filter until date (MM-DD-YYYY) |
| `sort_by` | string | No | Sort order: `most_relevant`, `newest` |
| `min_rating` | number | No | Minimum star rating (1-5) |
| `max_rating` | number | No | Maximum star rating (1-5) |

**Example URLs:**
- Google Play: `https://play.google.com/store/apps/details?id=com.example.app`
- Apple App Store: `https://apps.apple.com/us/app/example/id123456789`

**Returns:** App name, overall rating, review text, reviewer, rating, date, helpful votes, app version.

### product_reviews

Scan product reviews from G2 or Trustpilot.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | Product page URL on G2 or Trustpilot |
| `platform` | string | No | Override: `g2` or `trustpilot`. Auto-detected from URL. |
| `num_of_reviews` | number | No | Maximum number of reviews to collect |
| `start_date` | string | No | Filter from date (MM-DD-YYYY) |
| `end_date` | string | No | Filter until date (MM-DD-YYYY) |
| `sort_by` | string | No | Sort order for reviews |
| `min_rating` | number | No | Minimum star rating (1-5) |
| `max_rating` | number | No | Maximum star rating (1-5) |
| `include_overview` | boolean | No | (G2 only) Also fetch product overview: overall rating, review count, categories, alternatives |

**Example URLs:**
- G2: `https://www.g2.com/products/slack/reviews`
- Trustpilot: `https://www.trustpilot.com/review/example.com`

**Returns:** Product name, overall rating, review text, reviewer, pros/cons, rating, date.

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

| Parameter | Type | Description |
|-----------|------|-------------|
| `num_of_reviews` | number | Max reviews to collect |
| `start_date` | string | From date (MM-DD-YYYY) |
| `end_date` | string | Until date (MM-DD-YYYY) |
| `sort_by` | string | Sort order (`most_relevant`, `newest`) |
| `min_rating` | number | Min star rating (1-5) |
| `max_rating` | number | Max star rating (1-5) |
| `include_overview` | boolean | G2 only: also fetch product overview |
