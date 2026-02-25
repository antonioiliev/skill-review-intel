export type ReviewIntelConfig = {
	apiKey: string;
	timeoutMs: number;
	datasetOverrides: Record<string, string>;
};

export const DEFAULT_DATASET_IDS: Record<string, string> = {
	google_play_reviews: "gd_m6zagkt024uwvvwuyu",
	apple_appstore_reviews: "gd_lsk9ki3u2iishmwrui",
	g2_reviews: "gd_l88xvdka1uao86xvlb",
	g2_overview: "gd_l88xp4k01qnhvyqlvw",
	trustpilot_reviews: "gd_lm5zmhwd2sni130p",
};

export type Platform =
	| "google_play"
	| "apple_appstore"
	| "g2"
	| "trustpilot";

const PLATFORM_PATTERNS: Array<{ pattern: RegExp; platform: Platform }> = [
	{ pattern: /play\.google\.com/i, platform: "google_play" },
	{ pattern: /apps\.apple\.com/i, platform: "apple_appstore" },
	{ pattern: /g2\.com/i, platform: "g2" },
	{ pattern: /trustpilot\.com/i, platform: "trustpilot" },
];

export function detectPlatform(url: string): Platform | undefined {
	for (const { pattern, platform } of PLATFORM_PATTERNS) {
		if (pattern.test(url)) return platform;
	}
	return undefined;
}

export function resolveDatasetId(
	cfg: ReviewIntelConfig,
	key: string,
): string {
	return cfg.datasetOverrides[key] ?? DEFAULT_DATASET_IDS[key] ?? key;
}

const ALLOWED_CONFIG_KEYS: readonly (keyof ReviewIntelConfig)[] = [
	"apiKey",
	"timeoutMs",
	"datasetOverrides",
];

function resolveEnvVars(value: string): string {
	return value.replace(/\$\{([^}]+)\}/g, (_, envVar) => {
		const envValue = process.env[envVar];
		if (!envValue) {
			throw new Error(`Environment variable ${envVar} is not set`);
		}
		return envValue;
	});
}

export function parseConfig(value: unknown): ReviewIntelConfig {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("review-intel config required");
	}
	const cfg = value as Record<string, unknown>;
	const unknown = Object.keys(cfg).filter(
		(k) => !ALLOWED_CONFIG_KEYS.includes(k),
	);

	if (unknown.length > 0) {
		throw new Error(
			`review-intel config has unknown keys: ${unknown.join(", ")}`,
		);
	}

	if (typeof cfg.apiKey !== "string" || !cfg.apiKey.trim()) {
		throw new Error("review-intel apiKey is required");
	}

	const timeoutMs =
		typeof cfg.timeoutMs === "number" ? Math.floor(cfg.timeoutMs) : 120_000;
	if (timeoutMs < 5_000 || timeoutMs > 300_000) {
		throw new Error(
			"review-intel timeoutMs must be between 5000 and 300000",
		);
	}

	const datasetOverrides: Record<string, string> = {};
	if (cfg.datasetOverrides && typeof cfg.datasetOverrides === "object") {
		for (const [k, v] of Object.entries(
			cfg.datasetOverrides as Record<string, unknown>,
		)) {
			if (typeof v === "string") datasetOverrides[k] = v;
		}
	}

	return {
		apiKey: resolveEnvVars(cfg.apiKey),
		timeoutMs,
		datasetOverrides,
	};
}
