import type { ReviewIntelConfig } from "./types.js";
import { resolveDatasetId } from "./types.js";

const BASE_URL = "https://api.brightdata.com/datasets/v3";

// Polling: exponential backoff starting at 2s, max 10s, up to config timeout
const POLL_INITIAL_MS = 2_000;
const POLL_MAX_MS = 10_000;

// 429 retry: parse Retry-After header, fallback 5s, cap 15s
const RATE_LIMIT_FALLBACK_MS = 5_000;
const RATE_LIMIT_MAX_MS = 15_000;

export type ScrapeResult = Record<string, unknown>[];

/**
 * Structured error from BrightData API responses.
 * Replaces generic Error throws with parseable fields for retry logic.
 */
export class BrightDataApiError extends Error {
	readonly status: number;
	readonly code: string | undefined;
	readonly errorType: string | undefined;
	/** Pairs of [fieldName, reason] from BrightData's validation errors array. */
	readonly fieldErrors: Array<[string, string]>;
	readonly rawBody: string;

	constructor(opts: {
		status: number;
		code?: string;
		errorType?: string;
		fieldErrors?: Array<[string, string]>;
		rawBody: string;
		message: string;
	}) {
		super(opts.message);
		this.name = "BrightDataApiError";
		this.status = opts.status;
		this.code = opts.code;
		this.errorType = opts.errorType;
		this.fieldErrors = opts.fieldErrors ?? [];
		this.rawBody = opts.rawBody;
	}

	get isValidationError(): boolean {
		return this.status === 400 && this.errorType === "validation";
	}

	get isRateLimited(): boolean {
		return this.status === 429;
	}

	get rejectedFieldNames(): string[] {
		return this.fieldErrors.map(([name]) => name);
	}
}

/** Parse Retry-After header value to milliseconds (capped). */
function parseRetryAfter(header: string | null): number {
	if (!header) return RATE_LIMIT_FALLBACK_MS;

	const seconds = Number(header);
	if (Number.isFinite(seconds) && seconds > 0) {
		return Math.min(seconds * 1000, RATE_LIMIT_MAX_MS);
	}

	// Retry-After can also be an HTTP-date; treat as fallback
	return RATE_LIMIT_FALLBACK_MS;
}

export class BrightDataClient {
	private readonly cfg: ReviewIntelConfig;

	constructor(cfg: ReviewIntelConfig) {
		this.cfg = cfg;
	}

	private headers(): Record<string, string> {
		return {
			Authorization: `Bearer ${this.cfg.apiKey}`,
			"Content-Type": "application/json",
		};
	}

	/**
	 * Scrape synchronously. If the API returns 202 (async), poll for the result.
	 * Retries once on 429 (rate limit) with Retry-After delay.
	 */
	async scrapeSync(
		datasetKey: string,
		inputs: Array<Record<string, unknown>>,
	): Promise<ScrapeResult> {
		const datasetId = resolveDatasetId(this.cfg, datasetKey);
		const url = `${BASE_URL}/scrape?dataset_id=${encodeURIComponent(datasetId)}&format=json`;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);

		try {
			const res = await this.fetchWithRateLimitRetry(url, inputs, controller);

			if (res.status === 200) {
				return (await res.json()) as ScrapeResult;
			}

			if (res.status === 202) {
				const snapshotId = await this.extractSnapshotId(res);
				return await this.pollSnapshot(snapshotId, controller);
			}

			await this.handleErrorResponse(res);
			// unreachable, handleErrorResponse always throws
			return [];
		} finally {
			clearTimeout(timer);
		}
	}

	/**
	 * POST with a single 429 retry. On first 429, waits per Retry-After
	 * then retries once. On second 429, returns the response for normal
	 * error handling.
	 */
	private async fetchWithRateLimitRetry(
		url: string,
		inputs: Array<Record<string, unknown>>,
		controller: AbortController,
	): Promise<Response> {
		const doFetch = () =>
			fetch(url, {
				method: "POST",
				headers: this.headers(),
				body: JSON.stringify(inputs),
				signal: controller.signal,
			});

		const res = await doFetch();

		if (res.status !== 429) return res;

		// First 429 — wait and retry once
		const waitMs = parseRetryAfter(res.headers.get("Retry-After"));
		await this.sleep(waitMs, controller.signal);

		return doFetch();
	}

	private async extractSnapshotId(res: Response): Promise<string> {
		const body = (await res.json()) as Record<string, unknown>;
		const id = body.snapshot_id;
		if (typeof id !== "string" || !id) {
			throw new Error("BrightData returned 202 but no snapshot_id");
		}
		return id;
	}

	private async pollSnapshot(
		snapshotId: string,
		controller: AbortController,
	): Promise<ScrapeResult> {
		let delay = POLL_INITIAL_MS;

		while (!controller.signal.aborted) {
			await this.sleep(delay, controller.signal);

			const progressRes = await fetch(
				`${BASE_URL}/progress/${encodeURIComponent(snapshotId)}`,
				{ headers: this.headers(), signal: controller.signal },
			);

			if (!progressRes.ok) {
				await this.handleErrorResponse(progressRes);
			}

			const progress = (await progressRes.json()) as Record<string, unknown>;
			const status = progress.status;

			if (status === "ready") {
				const snapshotRes = await fetch(
					`${BASE_URL}/snapshot/${encodeURIComponent(snapshotId)}?format=json`,
					{ headers: this.headers(), signal: controller.signal },
				);

				if (!snapshotRes.ok) {
					await this.handleErrorResponse(snapshotRes);
				}

				return (await snapshotRes.json()) as ScrapeResult;
			}

			if (status === "failed") {
				const msg =
					typeof progress.error === "string"
						? progress.error
						: "Scrape job failed";
				throw new Error(`BrightData scrape failed: ${msg}`);
			}

			// Still running -- back off
			delay = Math.min(delay * 1.5, POLL_MAX_MS);
		}

		throw new Error("BrightData request timed out");
	}

	/**
	 * Parse BrightData error responses into structured BrightDataApiError.
	 * BrightData validation errors have shape:
	 *   { "type": "validation", "errors": [["field_name", "reason"], ...] }
	 * (Some endpoints may use "error_type" instead of "type"; we check both.)
	 */
	private async handleErrorResponse(res: Response): Promise<never> {
		let rawBody = "";
		let parsed: Record<string, unknown> | null = null;

		try {
			rawBody = await res.text();
			parsed = JSON.parse(rawBody) as Record<string, unknown>;
		} catch {
			// body wasn't JSON or couldn't be read
		}

		const errorType =
			typeof parsed?.error_type === "string"
				? parsed.error_type
				: typeof parsed?.type === "string"
					? parsed.type
					: undefined;
		const code = typeof parsed?.code === "string" ? parsed.code : undefined;

		// Parse field errors from BrightData's [fieldName, reason][] format
		let fieldErrors: Array<[string, string]> = [];
		if (Array.isArray(parsed?.errors)) {
			fieldErrors = (parsed.errors as unknown[])
				.filter(
					(e): e is [string, string] =>
						Array.isArray(e) &&
						e.length >= 2 &&
						typeof e[0] === "string" &&
						typeof e[1] === "string",
				)
				.map(([name, reason]) => [name, reason]);
		}

		// Build a human-readable message
		let message: string;
		switch (res.status) {
			case 401:
				message = "BrightData auth failed: invalid API key";
				break;
			case 404:
				message = `BrightData dataset not found. ${rawBody.slice(0, 500)}`;
				break;
			case 429:
				message = `BrightData rate limited. ${rawBody.slice(0, 500)}`;
				break;
			case 400:
				if (fieldErrors.length > 0) {
					const details = fieldErrors.map(([f, r]) => `${f}: ${r}`).join("; ");
					message = `BrightData validation error: ${details}`;
				} else {
					message = `BrightData bad request (400): ${rawBody.slice(0, 500)}`;
				}
				break;
			default:
				message = `BrightData API error (${res.status}): ${rawBody.slice(0, 500) || res.statusText}`;
		}

		throw new BrightDataApiError({
			status: res.status,
			code,
			errorType,
			fieldErrors,
			rawBody: rawBody.slice(0, 2000),
			message,
		});
	}

	private sleep(ms: number, signal: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(resolve, ms);

			signal.addEventListener(
				"abort",
				() => {
					clearTimeout(timer);
					reject(new Error("BrightData request timed out"));
				},
				{ once: true },
			);
		});
	}
}
