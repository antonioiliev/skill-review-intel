import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { parseConfig } from "./src/types.js";
import { BrightDataClient } from "./src/client.js";
import { createAppReviewsTool } from "./src/tools/app-reviews.js";
import { createProductReviewsTool } from "./src/tools/product-reviews.js";

export default function register(api: OpenClawPluginApi) {
	const cfg = parseConfig(api.pluginConfig);
	const client = new BrightDataClient(cfg);

	api.registerTool(
		createAppReviewsTool(client) as unknown as AnyAgentTool,
		{ optional: true },
	);
	api.registerTool(
		createProductReviewsTool(client) as unknown as AnyAgentTool,
		{ optional: true },
	);
}
