// Every reviewable page/state, with an optional setup step.
const REPO = require("path").resolve(__dirname, "../..").split(require("path").sep).join("/");
const fs = require("fs");
const ROOT = REPO + "/public";
const firstWord = fs.readdirSync(ROOT + "/word").find((n) => n.endsWith(".html"));
const firstSurah = fs.readdirSync(ROOT + "/surah").find((n) => n.endsWith(".html"));
module.exports = [
  ["home", "/#/"],
  ["search", "/#/", async (p) => { await p.fill("#q", "\u0627\u0644"); await p.waitForTimeout(400); }],
  ["search-empty", "/#/", async (p) => { await p.fill("#q", "zzzz"); await p.waitForTimeout(400); }],
  ["surahs", "/#/surahs"], ["surah", "/#/surah/78"], ["word", "/#/word/79-3"],
  ["challenge", "/#/challenge"], ["day1-done", "/#/day/1"], ["day2", "/#/day/2"],
  ["quiz", "/#/quiz"],
  ["quiz-answered", "/#/quiz", async (p) => { await p.click("#app .opt"); }],
  ["quiz-result", "/#/quiz", async (p) => { for (let i = 0; i < 40 && await p.$("#app .opt"); i++) { await p.click("#app .opt"); await p.click('#app [data-a="qn"]'); } }],
  ["settings-sheet", "/#/", async (p) => { await p.click("#gear"); }],
  ["save-sheet", "/#/word/79-3", async (p) => { await p.click('#app [data-a="card"]'); await p.waitForTimeout(600); }],
  ["app-legal", "/#/privacy"], ["app-404", "/#/nope"],
  ["static-word", "/word/" + encodeURIComponent(firstWord)], ["static-surah", "/surah/" + encodeURIComponent(firstSurah)],
  ["static-legal", "/privacy/"], ["404", "/404.html"],
];
