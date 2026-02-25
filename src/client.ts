import type { ReviewIntelConfig } from "./types.js";
import { resolveDatasetId } from "./types.js";

const BASE_URL = "https://api.brightdata.com/datasets/v3";

// Polling: exponential backoff starting at 2s, max 10s, up to config timeout
const POLL_INITIAL_MS = 2_000;
const POLL_MAX_MS = 10_000;

export type ScrapeResult = Record<string, unknown>[];

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
			const res = await fetch(url, {
				method: "POST",
				headers: this.headers(),
				body: JSON.stringify(inputs),
				signal: controller.signal,
			});

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

	private async handleErrorResponse(res: Response): Promise<never> {
		let detail = "";
		try {
			const text = await res.text();
			detail = text.slice(0, 500);
		} catch {
			// ignore
		}

		switch (res.status) {
			case 401:
				throw new Error("BrightData auth failed: invalid API key");
			case 404:
				throw new Error(`BrightData dataset not found. ${detail}`);
			case 429:
				throw new Error(`BrightData rate limited. ${detail}`);
			default:
				throw new Error(
					`BrightData API error (${res.status}): ${detail || res.statusText}`,
				);
		}
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
