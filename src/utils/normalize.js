function normalizeArabic(str) {
  if (!str) return '';
  let s = String(str);
  s = s.replace(/\u0622/g, '\u0627').replace(/\u0623/g, '\u0627').replace(/\u0625/g, '\u0627').replace(/\u0671/g, '\u0627');
  s = s.replace(/\u06C0/g, '\u0647').replace(/\u06C2/g, '\u0647');
  s = s.normalize('NFKD');
  s = s.replace(/[\u0300-\u036f\u064B-\u065F\u06D6-\u06ED]/g, '');
  s = s.replace(/[\u0670\u0640]/g, '');
  s = s.replace(/\u0621/g, '');
  s = s.replace(/\u0649/g, '\u064A');
  s = s.replace(/\u0629/g, '\u0647');
  s = s.replace(/\u0624/g, '\u0648');
  s = s.replace(/\u0626/g, '\u064A');
  s = s.replace(/\u0660-\u0669/g, '');
  s = s.replace(/\s+/g, ' ');
  return s.trim();
}
module.exports = { normalizeArabic };

