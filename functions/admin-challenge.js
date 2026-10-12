/*
 * admin-challenge.js - pure, testable core of the admin Challenge API.
 *
 * Handlers receive an explicit context and return { status, body }. The HTTP
 * layer (functions/index.js) is responsible for authentication and Firestore
 * persistence; this module owns validation, authorization decisions and the
 * exact shape of responses (including the privacy rule for private notes).
 */

const C = require('./challenge');

const ADMIN_ACTIONS = new Set([
  'get',
  'setStartDate',
  'setReleasedUpTo',
  'setDay',
  'setNotes',
  'roulette',
  'releaseStatus',
]);

function bad(status, message) {
  return { status, body: { ok: false, error: message } };
}

/**
 * Run an admin challenge action.
 *
 * ctx = {
 *   isAdmin: boolean,
 *   action: string,
 *   payload: object,
 *   state: challenge state,
 *   notes: { [day]: string },
 *   resolveWord: (ref) => boolean,   // does the word exist in the data?
 *   random: () => number,
 * }
 */
function handleChallengeAction(ctx) {
  const c = ctx || {};
  const action = c.action;

  if (!ADMIN_ACTIONS.has(action)) return bad(400, 'unknown-action');
  if (c.isAdmin !== true) return bad(403, 'forbidden');

  const state = C.normalizeState(c.state);
  const notes = c.notes && typeof c.notes === 'object' ? c.notes : {};

  switch (action) {
    case 'get':
      // Admin view may include notes.
      return {
        status: 200,
        body: { ok: true, challenge: C.sanitizePublicChallenge(state), notes: Object.assign({}, notes) },
      };

    case 'releaseStatus': {
      const unlocked = C.computeUnlocked(state, c.progress || { done: [] });
      const days = state.days.map((d) => ({
        d: Number(d.d),
        status: C.dayStatus(state, Number(d.d), c.progress || { done: [] }),
      }));
      return {
        status: 200,
        body: { ok: true, unlocked, total: state.days.length, days, startDate: state.startDate, releasedUpTo: state.releasedUpTo },
      };
    }

    case 'setStartDate': {
      const value = c.payload && c.payload.startDate;
      if (value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        return bad(422, 'invalid-startDate');
      }
      return { status: 200, body: { ok: true, apply: { startDate: value } } };
    }

    case 'setReleasedUpTo': {
      const raw = c.payload && c.payload.releasedUpTo;
      if (raw === null || raw === '') {
        return { status: 200, body: { ok: true, apply: { releasedUpTo: null } } };
      }
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > state.days.length) {
        return bad(422, 'invalid-releasedUpTo');
      }
      return { status: 200, body: { ok: true, apply: { releasedUpTo: n } } };
    }

    case 'setDay': {
      const payload = c.payload || {};
      const dayNumber = Number(payload.day);
      const day = C.dayById(state, dayNumber);
      if (!day) return bad(404, 'day-not-found');

      const next = { d: dayNumber, w: Array.isArray(day.w) ? day.w.slice() : [], reel: day.reel || '' };

      if (payload.w != null) {
        if (!Array.isArray(payload.w)) return bad(422, 'invalid-words');
        const problems = C.validateDayReferences({ days: [{ d: dayNumber, w: payload.w }] }, c.resolveWord);
        if (problems.length) {
          return { status: 422, body: { ok: false, error: 'unknown-word', problems } };
        }
        next.w = payload.w.map((r) => (Array.isArray(r) ? [r[0], r[1]] : r));
      }
      if (payload.reel != null) {
        const reel = String(payload.reel);
        if (reel && !/^https:\/\//i.test(reel)) return bad(422, 'invalid-reel');
        next.reel = reel;
      }
      return { status: 200, body: { ok: true, apply: { day: next } } };
    }

    case 'setNotes': {
      const payload = c.payload || {};
      const dayNumber = Number(payload.day);
      if (!C.dayById(state, dayNumber)) return bad(404, 'day-not-found');
      if (typeof payload.note !== 'string') return bad(422, 'invalid-note');
      return {
        status: 200,
        body: { ok: true, apply: { notes: { [String(dayNumber)]: payload.note } } },
      };
    }

    case 'roulette': {
      const payload = c.payload || {};
      const dayNumber = Number(payload.day);
      const day = C.dayById(state, dayNumber);
      if (!day) return bad(404, 'day-not-found');
      const dayWords = Array.isArray(day.w) ? day.w : [];
      const result = C.rouletteSelect(dayWords, { random: c.random, avoid: payload.avoid });
      if (!result) return { status: 200, body: { ok: true, empty: true, day: dayNumber } };
      return {
        status: 200,
        body: { ok: true, day: dayNumber, index: result.index, ref: result.value, spinId: result.spinId },
      };
    }

    default:
      return bad(400, 'unknown-action');
  }
}

/**
 * Sanitize a challenge payload for a NON-admin viewer. Guarantees no private
 * notes are present. Used by any public endpoint.
 */
function publicChallenge(challenge) {
  return C.sanitizePublicChallenge(challenge);
}

module.exports = { handleChallengeAction, publicChallenge, ADMIN_ACTIONS };
