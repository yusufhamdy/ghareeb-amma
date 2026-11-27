/*
 * reel-links-core.js - the pure parts of scripts/reel-links.mjs (no network, no browser), shared with its tests.
 *
 *   dayMatches(text, n)          a caption or title names challenge day n: "<al-yawm> n", "<al-yawm> <ordinal word>"
 *                                (days 1-30) or "#<al-yawm>_n", Arabic-Indic or Western digits, any diacritics
 *   linkOk(key, url)             a link the command may write: https on the platform's own host (as the admin and the
 *                                publish build check) and the shape of one post: instagram.com/reel/<code>/,
 *                                tiktok.com/@<user>/video/<id>, youtube.com/shorts/<id>
 *   igTime(code), ttTime(id)     the post time encoded in an Instagram shortcode / a TikTok video id (ms), to order
 *                                posts newest first whatever a profile pins
 *   pickLatest(items, n)         the newest item ({ url, text, time?, order? }) whose text names day n
 *   planWrite(doc, n, links)     the next public/challenge document: only day n's EMPTY link fields set; a link that is
 *                                already set is reported, never overwritten; throws on an invalid link or document
 *   sameExcept(a, b, i, keys)    b equals a except day index i's fields in keys
 *   writeLinks(db, n, links, expected)
 *                                one firebase-admin transaction: re-reads public/challenge, refuses when it differs
 *                                from `expected` (the copy the owner confirmed), applies planWrite, verifies with
 *                                sameExcept that nothing else changed, writes.
 *
 * ASCII only: the Arabic words are written as \u escapes.
 */
"use strict";

const KEYS = ["reelIg", "reelTt", "reelYt"];
const NAMES = { reelIg: "Instagram", reelTt: "TikTok", reelYt: "YouTube" };
const HOSTS = {
  reelIg: ["instagram.com", "www.instagram.com"],
  reelTt: ["tiktok.com", "www.tiktok.com", "vm.tiktok.com"],
  reelYt: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"],
};
const PATHS = {
  reelIg: /^\/(reel|p)\/[A-Za-z0-9_-]+\/?$/,
  reelTt: /^\/@[A-Za-z0-9._-]+\/video\/[0-9]+\/?$/,
  reelYt: /^\/shorts\/[A-Za-z0-9_-]{11}\/?$/,
};

// --- Arabic normalisation and the day phrase -------------------------------------------------------------------
function norm(s) {
  return String(s == null ? "" : s)
    .replace(/[ً-ٰٟـ​-‏؜⁦-⁩﻿]/g, "") // diacritics, tatweel, marks
    .replace(/[آأإٱ]/g, "ا") // alef forms -> alef
    .replace(/ى/g, "ي") // alef maksura -> ya
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)) // Arabic-Indic digits
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0)) // Extended Arabic-Indic digits
    .replace(/\s+/g, " ");
}

const DAY = "اليوم"; // al-yawm
const UNITS = [null,
  "الاول", // 1 al-awwal
  "الثاني", // 2 al-thani
  "الثالث", // 3 al-thalith
  "الرابع", // 4 al-rabi
  "الخامس", // 5 al-khamis
  "السادس", // 6 al-sadis
  "السابع", // 7 al-sabi
  "الثامن", // 8 al-thamin
  "التاسع", // 9 al-tasi
];
const HADI = "الحادي"; // al-hadi (the 1 of 11 and 21)
const ASHAR = "عشر"; // ashar (teen)
const TENTH = "العاشر"; // 10 al-ashir
const TWENTY = ["العشرون", "العشرين"]; // al-ishrun/-in
const THIRTY = ["الثلاثون", "الثلاثين"]; // al-thalathun/-in
const WA = "و"; // wa (and)

// The ordinal phrases of day n (1-30), each a list of words, normalised.
function ordinals(n) {
  if (n >= 1 && n <= 9) return [[UNITS[n]]];
  if (n === 10) return [[TENTH]];
  if (n >= 11 && n <= 19) return [[n === 11 ? HADI : UNITS[n - 10], ASHAR]];
  if (n === 20) return TWENTY.map((t) => [t]);
  if (n >= 21 && n <= 29) return TWENTY.map((t) => [n === 21 ? HADI : UNITS[n - 20], WA + t]);
  if (n === 30) return THIRTY.map((t) => [t]);
  return [];
}

const SEP = "[\\s_]+";
const LETTER = "[\\u0621-\\u064A0-9A-Za-z]";

function dayRegexes(n) {
  const out = [new RegExp("#?" + DAY + SEP + "0*" + n + "(?![0-9])")];
  for (const words of ordinals(n)) {
    // a unit ordinal (1-10) must not be the start of a longer number ("al-thani ashar" is 12, "al-thani wa-l-ishrun" 22)
    const tail = words.length === 1 && n <= 10 ? "(?!" + SEP + "(" + ASHAR + "|" + WA + TWENTY[0].slice(0, 5) + "|" + WA + THIRTY[0].slice(0, 5) + "))" : "";
    out.push(new RegExp("#?" + DAY + SEP + words.join(SEP) + "(?!" + LETTER + ")" + tail));
  }
  return out;
}

function dayMatches(text, n) {
  n = Number(n);
  if (!Number.isInteger(n) || n < 1) return false;
  const t = norm(text);
  return dayRegexes(n).some((r) => r.test(t));
}

// --- links ---------------------------------------------------------------------------------------------------------
function linkOk(key, url) {
  if (!HOSTS[key]) return false;
  try {
    const u = new URL(String(url));
    return u.protocol === "https:" && HOSTS[key].includes(u.hostname.toLowerCase()) && PATHS[key].test(u.pathname) && !u.username && !u.password;
  } catch (e) {
    return false;
  }
}

const IG_ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function igId(code) {
  let id = 0n;
  for (const c of String(code)) {
    const i = IG_ALPHA.indexOf(c);
    if (i < 0) return null;
    id = id * 64n + BigInt(i);
  }
  return id;
}
// Instagram media ids carry the post time in ms since 2011-08-24 21:07:01.721 UTC in their top bits.
function igTime(code) {
  const id = igId(String(code).slice(0, 11));
  return id == null ? null : Number(id >> 23n) + 1314220021721;
}
// TikTok video ids carry the post time in seconds in their top 32 bits.
function ttTime(id) {
  try { return Number(BigInt(String(id)) >> 32n) * 1000; } catch (e) { return null; }
}

// items: [{ url, text, time (ms, optional), order (page order, newest first, optional) }]
function pickLatest(items, n) {
  const hits = (items || []).filter((it) => it && it.url && dayMatches(it.text, n));
  hits.sort((a, b) => (b.time != null && a.time != null ? b.time - a.time : (a.order || 0) - (b.order || 0)));
  return hits[0] || null;
}

// --- the challenge document ------------------------------------------------------------------------------------------
function canon(v) {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}

function checkDoc(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("public/challenge is not a document");
  const extra = Object.keys(doc).filter((k) => !["startDate", "releasedUpTo", "days"].includes(k));
  if (extra.length) throw new Error("public/challenge has unexpected fields: " + extra.join(", "));
  if (!Array.isArray(doc.days)) throw new Error("public/challenge has no days list");
}

function dayIndex(doc, n) {
  const idx = doc.days.map((d, i) => (d && Number(d.d) === Number(n) ? i : -1)).filter((i) => i >= 0);
  if (idx.length !== 1) throw new Error("day " + n + " is " + (idx.length ? "listed " + idx.length + " times" : "not in the challenge"));
  return idx[0];
}

// links: { reelIg?, reelTt?, reelYt? } (the found links; a missing key = not found)
function planWrite(doc, n, links) {
  checkDoc(doc);
  const i = dayIndex(doc, n), next = JSON.parse(JSON.stringify(doc)), day = next.days[i];
  const written = [], skipped = [], notFound = [];
  for (const key of KEYS) {
    const link = links && links[key];
    if (!link) { notFound.push(key); continue; }
    if (!linkOk(key, link)) throw new Error("refusing an invalid " + NAMES[key] + " link for day " + n);
    const cur = doc.days[i][key];
    if (typeof cur === "string" && cur !== "") { skipped.push({ key, same: cur === link }); continue; }
    day[key] = link;
    written.push(key);
  }
  return { next, index: i, written, skipped, notFound };
}

function sameExcept(a, b, i, keys) {
  const x = JSON.parse(JSON.stringify(b));
  for (const k of keys) {
    if (a.days[i] && k in a.days[i]) x.days[i][k] = a.days[i][k];
    else delete x.days[i][k];
  }
  return canon(a) === canon(x);
}

async function writeLinks(db, n, links, expected) {
  const ref = db.collection("public").doc("challenge");
  let plan = null;
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new Error("public/challenge does not exist");
    const cur = s.data();
    if (expected && canon(cur) !== canon(expected)) throw new Error("public/challenge changed after it was read; nothing written, run the command again");
    plan = planWrite(cur, n, links);
    if (!plan.written.length) return;
    if (!sameExcept(cur, plan.next, plan.index, plan.written)) throw new Error("internal check failed: another field would change; nothing written");
    tx.set(ref, plan.next);
  });
  return plan;
}

module.exports = { KEYS, NAMES, HOSTS, norm, ordinals, dayMatches, linkOk, igId, igTime, ttTime, pickLatest, canon, checkDoc, dayIndex, planWrite, sameExcept, writeLinks };
