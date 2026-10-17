const { exec } = require("child_process");
const path = require("path");

const DEFAULT_INTERVAL_MS = 2 * 60 * 1000;

function isEnabled(value) {
  if (value == null || value === "") return true;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function getIntervalMs(env = process.env) {
  const ms = Number(env.GIT_PULL_INTERVAL_MS);
  if (Number.isFinite(ms) && ms >= 5000) return ms;
  const seconds = Number(env.GIT_PULL_INTERVAL_SECONDS);
  if (Number.isFinite(seconds) && seconds >= 5) return seconds * 1000;
  return DEFAULT_INTERVAL_MS;
}

function startGitPullLoop({
  cwd = path.join(__dirname, ".."),
  intervalMs = getIntervalMs(),
  enabled = isEnabled(process.env.GIT_PULL_ENABLED),
  execFn = exec,
  log = console,
} = {}) {
  if (!enabled) {
    log.log("[git-pull] disabled");
    return { stop() {} };
  }

  log.log(`[git-pull] every ${Math.round(intervalMs / 1000)}s from ${cwd}`);

  const run = () => {
    execFn("git pull", { cwd }, (err, stdout, stderr) => {
      if (err) {
        log.error("[git-pull] failed:", err.message);
        if (stderr && String(stderr).trim()) {
          log.error("[git-pull]", String(stderr).trim());
        }
        return;
      }
      log.log("[git-pull]", String(stdout || "").trim() || "ok");
    });
  };

  run();
  const timer = setInterval(run, intervalMs);
  if (typeof timer.unref === "function") timer.unref();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  getIntervalMs,
  startGitPullLoop,
};
