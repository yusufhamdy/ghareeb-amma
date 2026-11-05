/*
 * publish-report.mjs - the review report of a publish (Phase 5): the description of the publish pull request.
 *
 *   buildReport({ before, after, beforeChallenge, afterChallenge, summary, meta }) -> Markdown string
 *
 * before / after are surah lists in the committed shape (the committed public/words.json and the normalised Firestore
 * data); the challenges are public challenge payloads; summary is publishToTree's summary (file names and counts).
 * The report lists, per surah, the words added, removed and changed, and for each changed word every changed field
 * with its value before and after. That is document content, and the report is the one place it appears: it is
 * written to a file for the pull request description and is never printed to a log. It holds only what the publish
 * makes public, never anything else.
 * ASCII-only: values are copied in as they are; the labels are English.
 */
import { wordIndex, surahNumber } from "./publish-build.mjs";

// Markdown-inert text: every character Markdown or HTML could act on becomes a numeric entity, and line breaks a space.
export function mdText(v) {
  return String(v == null ? "" : v).replace(/[\r\n]+/g, " ").replace(/[\\`*_{}\[\]()<>#+\-.!|~&"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
}

const ayahText = (a) => (a && Array.isArray(a.segments) ? a.segments.map((g) => g.before + g.hl + g.after).join(" ") : "");
const FIELDS = [
  ["word", (w) => w.word],
  ["meaning", (w) => w.meaning],
  ["ayah label", (w) => w.ayah && w.ayah.label],
  ["ayah text", (w) => ayahText(w.ayah)],
  ["highlight", (w) => (w.ayah && Array.isArray(w.ayah.segments) ? w.ayah.segments.map((g) => g.num + ":" + g.hl).join(" / ") : "")],
  ["source", (w) => w.source],
];

// Per word: which fields differ between two versions of it.
export function changedFields(a, b) {
  return FIELDS.filter(([, get]) => get(a) !== get(b)).map(([name, get]) => ({ name, before: get(a), after: get(b) }));
}

export function diffWords(before, after) {
  const A = wordIndex(before), B = wordIndex(after);
  const out = { added: [], removed: [], changed: [] };
  for (const [slug, w] of B) {
    if (!A.has(slug)) out.added.push(w);
    else {
      const f = changedFields(A.get(slug), w);
      if (f.length) out.changed.push({ slug, no: w.no, word: w, fields: f });
    }
  }
  for (const [slug, w] of A) if (!B.has(slug)) out.removed.push(w);
  return out;
}

export function diffChallenge(a, b) {
  const da = (a && a.days) || [], db = (b && b.days) || [];
  const out = [];
  for (let i = 0; i < Math.max(da.length, db.length); i++) {
    const x = da[i], y = db[i];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    const keys = [...new Set([...Object.keys(x || {}), ...Object.keys(y || {})])].filter((k) => JSON.stringify((x || {})[k]) !== JSON.stringify((y || {})[k]));
    out.push({ d: (y || x).d, keys });
  }
  for (const k of ["startDate", "releasedUpTo"]) if ((a || {})[k] !== (b || {})[k]) out.push({ top: k, before: (a || {})[k], after: (b || {})[k] });
  return out;
}

export function buildReport({ before, after, beforeChallenge, afterChallenge, summary, meta = {} }) {
  const d = diffWords(before, after);
  const ch = diffChallenge(beforeChallenge, afterChallenge);
  const L = [];
  L.push("## Publish: Firestore rev " + (summary.rev == null ? "unknown" : summary.rev));
  L.push("");
  if (meta.readAt) L.push("- Read from Firestore at: " + mdText(meta.readAt));
  if (meta.actor) L.push("- Run by: " + mdText(meta.actor));
  if (meta.note) L.push("- Note: " + mdText(meta.note));
  L.push("- Surahs: " + summary.surahs.before + " -> " + summary.surahs.after + (summary.surahs.removed.length ? " (removed: " + summary.surahs.removed.join(", ") + ")" : ""));
  L.push("- Words: " + summary.words.before + " -> " + summary.words.after + " (" + d.added.length + " added, " + d.removed.length + " removed, " + d.changed.length + " changed)");
  L.push("- Challenge days: " + ((afterChallenge && afterChallenge.days) || []).length + (ch.length ? " (" + ch.length + " changes)" : " (no change)"));
  L.push("");
  const nos = [...new Set([...d.added, ...d.removed, ...d.changed.map((c) => c.word)].map((w) => w.no))].sort((a, b) => b - a);
  const nameOf = (no) => {
    const s = after.find((x) => surahNumber(x.surah) === no) || before.find((x) => surahNumber(x.surah) === no);
    return s ? s.surah : "";
  };
  if (!nos.length) L.push("No word changes.");
  for (const no of nos) {
    L.push("### Surah " + no + " " + mdText(nameOf(no)));
    L.push("");
    for (const w of d.added.filter((x) => x.no === no)) L.push("- **Added** `" + w.slug + "`: " + mdText(w.word) + " (meaning: " + mdText(w.meaning) + ")");
    for (const w of d.removed.filter((x) => x.no === no)) L.push("- **Removed** `" + w.slug + "`: " + mdText(w.word));
    for (const c of d.changed.filter((x) => x.no === no)) {
      L.push("- **Changed** `" + c.slug + "`: " + c.fields.map((f) => f.name).join(", "));
      for (const f of c.fields) {
        L.push("  - " + f.name + " before: " + mdText(f.before));
        L.push("  - " + f.name + " after: " + mdText(f.after));
      }
    }
    L.push("");
  }
  if (ch.length) {
    L.push("### Challenge");
    L.push("");
    for (const c of ch) L.push(c.top ? "- " + c.top + ": " + mdText(c.before) + " -> " + mdText(c.after) : "- Day " + c.d + ": " + c.keys.join(", ") + " changed");
    L.push("");
  }
  L.push("### Files");
  L.push("");
  L.push("- Written (" + summary.write.length + "): " + (summary.write.map((f) => "`" + f + "`").join(", ") || "none"));
  L.push("- Removed (" + summary.remove.length + "): " + (summary.remove.map((f) => "`" + f + "`").join(", ") || "none"));
  L.push("- Share images made again (" + summary.images.length + "): " + (summary.images.map((f) => "`" + f + "`").join(", ") || "none"));
  L.push("- Redirects added (" + summary.redirects.added.length + "): " + (summary.redirects.added.map((f) => "`" + f + "`").join(", ") || "none"));
  if (meta.checks) {
    L.push("");
    L.push("### Checks");
    L.push("");
    for (const [k, v] of Object.entries(meta.checks)) L.push("- " + mdText(k) + ": " + mdText(v));
  }
  L.push("");
  return L.join("\n");
}
