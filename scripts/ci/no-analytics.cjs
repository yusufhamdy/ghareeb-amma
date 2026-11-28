"use strict";
/*
 * no-analytics.cjs - automated runs never reach Cloudflare Web Analytics.
 *
 * The public pages load the Cloudflare beacon (static.cloudflareinsights.com) and it reports to
 * cloudflareinsights.com. A test or check must not count as a visit, so every Playwright browser context opened in a
 * process that loads this file answers those hosts locally: the beacon script with an empty script, anything else
 * with an empty 204. Nothing leaves the machine and the page sees no error.
 *
 * Loaded with --require by `npm test` (package.json) and the CI shard runner (scripts/ci/shard-tests.mjs), and
 * passed on to child processes (the emulator checks a test starts) through NODE_OPTIONS. A check that runs
 * against the live site or the preview by itself loads it too: node --require ./scripts/ci/no-analytics.cjs ...
 * ASCII only.
 */
const HOSTS = /^https?:\/\/([a-z0-9-]+\.)*cloudflareinsights\.com\//i;

if (!String(process.env.NODE_OPTIONS || "").includes("no-analytics.cjs")) {
  process.env.NODE_OPTIONS = (process.env.NODE_OPTIONS ? process.env.NODE_OPTIONS + " " : "") + "--require " + JSON.stringify(__filename);
}

async function guard(ctx) {
  if (!ctx || ctx.__noAnalytics) return ctx;
  ctx.__noAnalytics = true;
  await ctx.route(HOSTS, (route) => {
    const js = /\/beacon\.min\.js(\?|$)/.test(route.request().url());
    return route.fulfill(js
      ? { status: 200, contentType: "text/javascript", body: "", headers: { "access-control-allow-origin": "*" } }
      : { status: 204, body: "", headers: { "access-control-allow-origin": "*" } });
  });
  return ctx;
}

function patchBrowser(browser) {
  if (!browser || browser.__noAnalytics) return browser;
  browser.__noAnalytics = true;
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...a) => guard(await newContext(...a));
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...a) => { const p = await newPage(...a); await guard(p.context()); return p; };
  return browser;
}

function patchType(bt) {
  if (!bt || bt.__noAnalytics) return;
  bt.__noAnalytics = true;
  const launch = bt.launch.bind(bt);
  bt.launch = async (...a) => patchBrowser(await launch(...a));
  const persistent = bt.launchPersistentContext.bind(bt);
  bt.launchPersistentContext = async (...a) => guard(await persistent(...a));
}

for (const mod of ["playwright", "playwright-core"]) {
  let pw;
  try { pw = require(mod); } catch (e) { continue; }
  for (const t of ["chromium", "firefox", "webkit"]) patchType(pw[t]);
}

module.exports = { HOSTS, guard };
