/*
 * challenge.js - single source of truth for challenge release logic.
 *
 * Pure module (no Firebase dependency) so it can be unit-tested in Node and
 * used by the publish build (scripts/publish-build.mjs).
 *
 * RELEASE MODEL (owner decision, 2026-11)
 * -------------
 * SCHEDULED: day N opens at 22:00 Africa/Cairo on startDate + (N - 1) days
 * (startDate 2026-11-21: day 1 at 2026-11-21 22:00, day 7 at 2026-11-27 22:00,
 * day 30 at 2026-12-20 22:00). `releasedUpTo` stays an admin override: days up
 * to it are open now. An open day is open for everyone; finishing a day never
 * opens the next one early. A day can be marked done once the user has viewed
 * the meanings of ALL of its words. Without a startDate only the override
 * opens days.
 *
 * `computeUnlocked` is THE release rule (mirrored by released() in
 * public/index.html); every other function goes through it.
 *
 * TIMEZONE: every calendar computation uses Africa/Cairo explicitly. Never use
 * the host's or browser's local timezone.
 */

const CAIRO_TZ = 'Africa/Cairo';

/** Format a Date as YYYY-MM-DD in the Africa/Cairo timezone. */
function cairoDateString(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) throw new Error('invalid date');
  // en-CA yields ISO-like YYYY-MM-DD.
  return d.toLocaleDateString('en-CA', { timeZone: CAIRO_TZ });
}

/** Whole-day difference (b - a) for two YYYY-MM-DD strings. */
function daysBetween(a, b) {
  const toUtc = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    if (!m) throw new Error('expected YYYY-MM-DD, got: ' + s);
    return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** The hour (Cairo time) at which each day opens. */
const OPEN_HOUR = 22;

const CAIRO_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAIRO_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** Wall-clock parts of an instant in Africa/Cairo: { date: 'YYYY-MM-DD', hour, minute, second }. */
function cairoParts(when) {
  const t = when == null ? Date.now() : when instanceof Date ? when.getTime() : Number(when);
  const p = {};
  CAIRO_FMT.formatToParts(new Date(t)).forEach((x) => { p[x.type] = x.value; });
  return { date: p.year + '-' + p.month + '-' + p.day, hour: +p.hour % 24, minute: +p.minute, second: +p.second };
}

/** YYYY-MM-DD plus n days. */
function addDays(s, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) throw new Error('expected YYYY-MM-DD, got: ' + s);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n)).toISOString().slice(0, 10);
}

const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** The instant (ms) day n opens: 22:00 Cairo on startDate + (n - 1). null without a valid startDate. */
function dayOpensAt(state, dayNumber) {
  const s = normalizeState(state);
  if (!validDate(s.startDate)) return null;
  const [y, m, d] = addDays(s.startDate, Number(dayNumber) - 1).split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, OPEN_HOUR);
  const off = (t) => {
    const p = cairoParts(t);
    const [py, pm, pd] = p.date.split('-').map(Number);
    return Date.UTC(py, pm - 1, pd, p.hour, p.minute, p.second) - t;
  };
  return guess - off(guess - off(guess)); // the offset at the opening instant itself (daylight saving)
}

/** Days opened by the schedule alone at an instant (0..N). */
function scheduledCount(state, now) {
  const s = normalizeState(state);
  if (!validDate(s.startDate)) return 0;
  const p = cairoParts(now);
  const k = daysBetween(s.startDate, p.date) + (p.hour >= OPEN_HOUR ? 1 : 0);
  return clamp(k, 0, s.days.length);
}

/**
 * Normalize a challenge state object into a safe shape.
 * Never includes private notes.
 */
function normalizeState(state) {
  const src = state && typeof state === 'object' ? state : {};
  const days = Array.isArray(src.days) ? src.days.slice() : [];
  return {
    startDate: typeof src.startDate === 'string' ? src.startDate : null,
    releasedUpTo:
      src.releasedUpTo == null ? null : Number(src.releasedUpTo),
    days,
  };
}

/** Normalize per-device progress. `viewed` is { [day]: { [wordKey]: true } }. */
function normalizeProgress(progress) {
  const p = progress && typeof progress === 'object' ? progress : {};
  const done = Array.isArray(p.done)
    ? p.done.map(Number).filter((n) => Number.isInteger(n))
    : [];
  const viewed =
    p.viewed && typeof p.viewed === 'object' && !Array.isArray(p.viewed)
      ? p.viewed
      : {};
  return { done, viewed };
}

/** Stable key for a day word reference: "surahNo::normalizedWord". */
function wordKey(ref) {
  if (Array.isArray(ref)) return String(ref[0]) + '::' + String(ref[1]);
  if (ref && typeof ref === 'object') {
    return String(ref[0] != null ? ref[0] : ref.surah) + '::' + String(ref[1] != null ? ref[1] : ref.word);
  }
  return String(ref);
}

function dayById(state, dayNumber) {
  return normalizeState(state).days.find((d) => Number(d.d) === Number(dayNumber)) || null;
}

/** All word keys for a day (empty array when the day is unknown). */
function dayWordKeys(state, dayNumber) {
  const day = dayById(state, dayNumber);
  if (!day || !Array.isArray(day.w)) return [];
  return day.w.map(wordKey);
}

/**
 * Number of open days at `now` (ms or Date; default the current time). Two
 * inputs combine, the larger wins:
 *  - the schedule: day N opens at 22:00 Cairo on startDate + (N - 1);
 *  - the admin override `releasedUpTo`, which opens days up to it now.
 * Progress never opens a day (the parameter keeps the callers' shape).
 *
 * This is THE release rule (mirror: released() in public/index.html).
 */
function computeUnlocked(state, progress, now) {
  const s = normalizeState(state);
  const N = s.days.length;
  const override =
    s.releasedUpTo != null && Number.isFinite(s.releasedUpTo)
      ? clamp(Math.trunc(s.releasedUpTo), 0, N)
      : 0;
  return Math.max(scheduledCount(s, now), override);
}

/** The current day = first open day not yet done (or the last open day). */
function frontierDay(state, progress, now) {
  const open = computeUnlocked(state, progress, now);
  const p = normalizeProgress(progress);
  for (let n = 1; n <= open; n++) {
    if (!p.done.includes(n)) return n;
  }
  return Math.max(1, open);
}

/** Single decision point: is a day open right now? */
function isDayUnlocked(state, dayNumber, progress, now) {
  const n = Number(dayNumber);
  if (!Number.isInteger(n) || n < 1) return false;
  if (n > normalizeState(state).days.length) return false;
  return n <= computeUnlocked(state, progress, now);
}

/**
 * Visual state for a grid day.
 * Returns one of: 'locked' | 'done' | 'today' | 'available' | 'unknown'.
 */
function dayStatus(state, dayNumber, progress, now) {
  if (!dayById(state, dayNumber)) return 'unknown';
  const p = normalizeProgress(progress);
  const open = computeUnlocked(state, progress, now);
  const n = Number(dayNumber);
  if (n > open) return 'locked';
  if (p.done.includes(n)) return 'done';
  if (n === frontierDay(state, progress, now)) return 'today';
  return 'available';
}

/** Human/Machine check: were ALL meanings of a day viewed? */
function viewedAllMeanings(state, dayNumber, progress) {
  const keys = dayWordKeys(state, dayNumber);
  if (!keys.length) return false;
  const p = normalizeProgress(progress);
  const seen = p.viewed && p.viewed[String(dayNumber)] ? p.viewed[String(dayNumber)] : {};
  return keys.every((k) => seen[k] === true);
}

/**
 * Can the user mark this day done? Requires: day unlocked AND every meaning in
 * the day viewed. Already-done days return true (toggle-off is allowed).
 */
function canMarkDayDone(state, dayNumber, progress, now) {
  const n = Number(dayNumber);
  if (!isDayUnlocked(state, n, progress, now)) return false;
  const p = normalizeProgress(progress);
  if (p.done.includes(n)) return true; // allow un-marking
  return viewedAllMeanings(state, n, progress);
}

/**
 * Apply a "mark done / unmark" action, returning { progress, changed, reason }.
 * Idempotent: marking an already-done day twice does not duplicate it.
 */
function toggleDayDone(state, dayNumber, progress, now) {
  const n = Number(dayNumber);
  const p = normalizeProgress(progress);
  if (!isDayUnlocked(state, n, progress, now)) {
    return { progress: { done: p.done.slice(), viewed: p.viewed }, changed: false, reason: 'locked' };
  }
  const already = p.done.includes(n);
  if (!already && !viewedAllMeanings(state, n, progress)) {
    return { progress: { done: p.done.slice(), viewed: p.viewed }, changed: false, reason: 'not-viewed' };
  }
  const done = already
    ? p.done.filter((x) => x !== n)
    : p.done.concat(n).sort((a, b) => a - b);
  return { progress: { done, viewed: p.viewed }, changed: true, reason: already ? 'unmarked' : 'marked' };
}

/** Record that a single word's meaning was viewed (per day, per word). */
function markViewed(progress, dayNumber, ref) {
  const p = normalizeProgress(progress);
  const day = String(Number(dayNumber));
  const viewed = Object.assign({}, p.viewed);
  viewed[day] = Object.assign({}, viewed[day]);
  viewed[day][wordKey(ref)] = true;
  return { done: p.done.slice(), viewed };
}

/**
 * Server-side roulette selection. Pure and auditable: takes the pool and an
 * injectable random function, returns the chosen index/value plus a spin id.
 * Never mutates the pool. Empty pool returns null.
 */
function rouletteSelect(pool, opts) {
  const options = opts || {};
  const list = Array.isArray(pool) ? pool : [];
  if (!list.length) return null;
  const rand = typeof options.random === 'function' ? options.random : Math.random;
  const avoid = options.avoid;
  const keyOf = (v) => (Array.isArray(v) ? v[0] + '::' + v[1] : v);
  const avoidKey = avoid == null ? null : keyOf(avoid);
  const candidates = [];
  for (let i = 0; i < list.length; i++) {
    if (list.length > 1 && avoidKey != null && keyOf(list[i]) === avoidKey) continue;
    candidates.push(i);
  }
  const pickPool = candidates.length ? candidates : list.map((_, i) => i);
  const r = rand();
  const safe = Number.isFinite(r) ? Math.min(0.9999999, Math.max(0, r)) : 0;
  const idx = pickPool[Math.floor(safe * pickPool.length)];
  return {
    index: idx,
    value: list[idx],
    spinId: (options.spinId != null ? options.spinId : '') + ':' + idx,
  };
}

/** Validate that every word reference in every day resolves against the data. */
function validateDayReferences(state, resolve) {
  const s = normalizeState(state);
  const problems = [];
  s.days.forEach((day) => {
    (Array.isArray(day.w) ? day.w : []).forEach((ref, i) => {
      const ok = typeof resolve === 'function' ? resolve(ref) : true;
      if (!ok) problems.push({ day: Number(day.d), index: i, ref });
    });
  });
  return problems;
}

/**
 * Strip everything that must never reach a non-admin client. Public challenge
 * is exactly { startDate, releasedUpTo, days:[{d,w,reel}] }.
 */
function sanitizePublicChallenge(state) {
  const s = normalizeState(state);
  return {
    startDate: s.startDate,
    releasedUpTo: s.releasedUpTo == null ? null : Number(s.releasedUpTo),
    days: s.days.map((day) => ({
      d: Number(day.d),
      w: Array.isArray(day.w) ? day.w.map((r) => (Array.isArray(r) ? [r[0], r[1]] : r)) : [],
      reel: day && day.reel ? String(day.reel) : '',
    })),
  };
}

/**
 * Attach private notes to a challenge payload ONLY for an admin. For anyone
 * else the notes key is entirely absent (never an empty object, never null).
 */
function withNotesForViewer(challenge, notes, isAdmin) {
  const out = sanitizePublicChallenge(challenge);
  if (isAdmin === true) {
    out.notes = notes && typeof notes === 'object' ? Object.assign({}, notes) : {};
  }
  return out;
}

module.exports = {
  CAIRO_TZ,
  OPEN_HOUR,
  cairoDateString,
  cairoParts,
  addDays,
  dayOpensAt,
  scheduledCount,
  daysBetween,
  normalizeState,
  normalizeProgress,
  wordKey,
  dayById,
  dayWordKeys,
  computeUnlocked,
  frontierDay,
  isDayUnlocked,
  dayStatus,
  viewedAllMeanings,
  canMarkDayDone,
  toggleDayDone,
  markViewed,
  rouletteSelect,
  validateDayReferences,
  sanitizePublicChallenge,
  withNotesForViewer,
};
