const DEFAULT_TIMEOUT_MS = 15000;

function getWebhookConfig(env = process.env) {
  const url = String(env.HOUSE_TRACKER_WEBHOOK_URL || "").trim();
  const auth = String(env.HOUSE_TRACKER_WEBHOOK_AUTH || "").trim();
  return { url, auth };
}

async function postHouseTrackerPayload(
  payload,
  { fetchFn = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, env = process.env } = {}
) {
  const { url, auth } = getWebhookConfig(env);
  if (!url) {
    const error = new Error(
      "House Tracker webhook is not configured. Set HOUSE_TRACKER_WEBHOOK_URL (and HOUSE_TRACKER_WEBHOOK_AUTH) in .env."
    );
    error.statusCode = 503;
    error.code = "WEBHOOK_NOT_CONFIGURED";
    throw error;
  }

  const headers = { "Content-Type": "application/json" };
  if (auth) headers.Authorization = auth;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      const error = new Error(
        `House Tracker webhook returned ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`
      );
      error.statusCode = 502;
      error.code = "WEBHOOK_FAILED";
      throw error;
    }

    return { ok: true, status: response.status };
  } catch (err) {
    if (err.code === "WEBHOOK_NOT_CONFIGURED" || err.code === "WEBHOOK_FAILED") throw err;
    const error = new Error(
      err.name === "AbortError"
        ? "House Tracker webhook timed out. Try again in a moment."
        : `Could not reach House Tracker webhook: ${err.message}`
    );
    error.statusCode = 502;
    error.code = "WEBHOOK_FAILED";
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function postToHouseTracker(input, opts = {}) {
  return postHouseTrackerPayload({ input: String(input).trim() }, opts);
}

module.exports = {
  getWebhookConfig,
  postHouseTrackerPayload,
  postToHouseTracker,
};
