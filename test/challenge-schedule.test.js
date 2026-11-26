/*
 * challenge-schedule.test.js - the scheduled release (owner decision, 2026-11): day N opens at 22:00 Africa/Cairo on
 * startDate + (N - 1) days; releasedUpTo is an admin override; finishing a day never opens the next one early.
 *
 *   - shared/challenge.js: just before and just after 22:00 Cairo (day 7 and day 30 of a 2026-11-21 start, and a
 *     summer date, when Cairo is UTC+3);
 *   - public/index.html (its mirror, released()): the same answers in a browser, the lock message, and the open state
 *     changing by itself at 22:00 without a reload (Playwright's simulated clock), with days 1-6 done.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const C = require("../shared/challenge.js");
const { serve } = require("../scripts/checks/lib.js");

const PUBLIC = path.join(__dirname, "..", "public");
const days = JSON.parse(fs.readFileSync(path.join(PUBLIC, "challenge.json"), "utf8")).days;
const STATE = { startDate: "2026-11-21", releasedUpTo: 6, days };
const at = (iso) => Date.parse(iso);
const ALL6 = [1, 2, 3, 4, 5, 6];

test("shared rule: day 7 opens at 2026-11-27 22:00 Cairo, day 30 at 2026-12-20 22:00, not a millisecond before", () => {
  assert.strictEqual(days.length, 30);
  assert.strictEqual(C.computeUnlocked(STATE, { done: ALL6 }, at("2026-11-27T19:59:59.999Z")), 6, "21:59:59.999 Cairo: day 7 still locked");
  assert.strictEqual(C.computeUnlocked(STATE, { done: ALL6 }, at("2026-11-27T20:00:00.000Z")), 7, "22:00 Cairo: day 7 open");
  assert.strictEqual(C.isDayUnlocked(STATE, 7, { done: ALL6 }, at("2026-11-27T19:59:59Z")), false, "finishing days 1-6 does not open day 7 early");
  assert.strictEqual(C.computeUnlocked(STATE, {}, at("2026-12-20T19:59:59Z")), 29);
  assert.strictEqual(C.computeUnlocked(STATE, {}, at("2026-12-20T20:00:00Z")), 30);
  assert.strictEqual(new Date(C.dayOpensAt(STATE, 7)).toISOString(), "2026-11-27T20:00:00.000Z");
  assert.strictEqual(new Date(C.dayOpensAt(STATE, 30)).toISOString(), "2026-12-20T20:00:00.000Z");
  // the override: days up to releasedUpTo are open now, before their time
  assert.strictEqual(C.computeUnlocked(STATE, {}, at("2026-11-22T00:00:00Z")), 6);
  // daylight saving: in July Cairo is UTC+3, so 22:00 Cairo is 19:00Z
  const summer = { startDate: "2026-07-01", releasedUpTo: null, days };
  assert.strictEqual(C.computeUnlocked(summer, {}, at("2026-07-01T18:59:59Z")), 0);
  assert.strictEqual(C.computeUnlocked(summer, {}, at("2026-07-01T19:00:00Z")), 1);
  assert.strictEqual(new Date(C.dayOpensAt(summer, 1)).toISOString(), "2026-07-01T19:00:00.000Z");
});

test("the site: same rule as shared/challenge.js, the lock message, and day 7 opens at 22:00 without a reload", { timeout: 120000 }, async (t) => {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return; }
  const { server, base } = await serve();
  const br = await chromium.launch();
  try {
    const ctx = await br.newContext({ viewport: { width: 390, height: 900 } });
    await ctx.addInitScript((done) => {
      try { localStorage.setItem("gq-ld", "1"); localStorage.setItem("gq-prog", JSON.stringify({ done })); } catch (e) {}
    }, ALL6);
    await ctx.route("**/challenge.json*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(STATE) }));
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.install({ time: new Date("2026-11-27T19:58:00Z") }); // 21:58 Cairo
    await page.goto(base + "/#/challenge");
    await page.waitForSelector("#app .cg .dy");

    // the mirror gives the same answers as the shared module
    for (const iso of ["2026-11-21T19:59:59Z", "2026-11-21T20:00:00Z", "2026-11-27T19:59:59.999Z", "2026-11-27T20:00:00Z", "2026-12-20T19:59:59Z", "2026-12-20T20:00:00Z", "2027-02-01T00:00:00Z"]) {
      assert.strictEqual(await page.evaluate((x) => released(x), at(iso)), C.computeUnlocked(STATE, {}, at(iso)), "released() at " + iso);
    }

    const state = () => page.evaluate(() => [...document.querySelectorAll("#app .cg .dy")].map((e) => (e.classList.contains("lk") ? "L" : "o")).join(""));
    assert.strictEqual(await state(), "o".repeat(6) + "L".repeat(24), "21:58 Cairo, days 1-6 done: day 7 is still locked");
    assert.strictEqual(await page.evaluate(() => lockMsg(7)), "يفتح اليوم 7 يوم الجمعة 27 نوفمبر الساعة 10 مساءً");
    await page.click('#app .cg .dy[data-d="7"]');
    await page.waitForFunction(() => /يفتح اليوم 7 يوم الجمعة 27 نوفمبر الساعة 10 مساءً/.test(document.body.textContent));

    await page.clock.runFor(119 * 1000); // 21:59:59
    assert.strictEqual(await state(), "o".repeat(6) + "L".repeat(24), "21:59:59 Cairo: still locked");
    await page.clock.runFor(2 * 1000); // 22:00:01
    await page.waitForFunction(() => !document.querySelector('#app .cg .dy:nth-child(7)').classList.contains("lk"), null, { timeout: 5000 });
    assert.strictEqual(await state(), "o".repeat(7) + "L".repeat(23), "22:00 Cairo: day 7 opens by itself, no reload");
    assert.deepStrictEqual(errors, []);
  } finally {
    await br.close();
    server.close();
  }
});
