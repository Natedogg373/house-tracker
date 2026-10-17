#!/usr/bin/env node
/**
 * Local stand-in for the House Tracker webhook.
 *   HOUSE_TRACKER_WEBHOOK_URL=http://127.0.0.1:8787/
 *   HOUSE_TRACKER_WEBHOOK_AUTH=Bearer test-token
 */
const http = require("http");

const port = Number(process.env.MOCK_PORT) || 8787;

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    console.log("Authorization:", req.headers.authorization || "(none)");
    console.log("Content-Type:", req.headers["content-type"] || "(none)");
    console.log("Body:", body || "(empty)");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, received: true }));
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Mock House Tracker webhook at http://127.0.0.1:${port}/`);
});
