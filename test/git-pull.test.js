const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { getIntervalMs, startGitPullLoop } = require("../lib/git-pull");

describe("getIntervalMs", () => {
  it("defaults to two minutes", () => {
    assert.equal(getIntervalMs({}), 120000);
  });

  it("reads GIT_PULL_INTERVAL_MS", () => {
    assert.equal(getIntervalMs({ GIT_PULL_INTERVAL_MS: "90000" }), 90000);
  });
});

describe("startGitPullLoop", () => {
  it("does not run git when disabled", () => {
    let called = 0;
    const pull = startGitPullLoop({
      enabled: false,
      execFn: () => {
        called += 1;
      },
      log: { log() {}, error() {} },
    });
    assert.equal(called, 0);
    pull.stop();
  });

  it("logs and continues when git pull fails", async () => {
    const errors = [];
    const pull = startGitPullLoop({
      enabled: true,
      intervalMs: 60 * 60 * 1000,
      execFn: (_cmd, _opts, cb) => cb(new Error("not a git repo"), "", "fatal: boom"),
      log: {
        log() {},
        error: (...args) => errors.push(args.map(String).join(" ")),
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    pull.stop();
    assert.ok(errors.some((line) => line.includes("failed")));
  });
});
