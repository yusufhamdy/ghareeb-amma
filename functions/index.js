const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
admin.initializeApp();

const SITE = "https://ghareebalquran.com";
const ORDER = "النبأ,النازعات,عبس,التكوير,الانفطار,المطففين,الانشقاق,البروج,الطارق,الأعلى,الغاشية,الفجر,البلد,الشمس,الليل,الضحى,الشرح,التين,العلق,القدر,البينة,الزلزلة,العاديات,القارعة,التكاثر,العصر,الهمزة,الفيل,قريش,الماعون,الكوثر,الكافرون,النصر,المسد,الإخلاص,الفلق,الناس".split(",");
const MARKS = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = (s) => s.replace(MARKS, "").replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").trim();
const slugOf = (w) => w.replace(MARKS, "").replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
  .replace(/[^\u0621-\u064A0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

let cache = { t: 0, words: [] };

async function load() {
  if (Date.now() - cache.t < 30000) return cache;
  const snap = await admin.firestore().doc("public/data").get();
  const list = snap.exists ? snap.data().surahs || [] : [];
  const words = [];
  const seen = {};
  const surahs = list.map((e) => {
    const name = e.surah.replace(/^سورة\s*/, "");
    const i = ORDER.indexOf(name);
    return { name, no: e.no || (i < 0 ? 999 : 78 + i), words: [] };
  });
  list.forEach((e, si) => {
    (e.words || []).forEach((w, wi) => {
      let m = (e.meanings || [])[wi] || "";
      const k = m.indexOf(":");
      if (k > 0 && norm(m.slice(0, k)) === norm(w)) m = m.slice(k + 1).trim();
      const a = (e.ayahs || [])[wi] || (e.ayahs || [])[0] || { label: "", segments: [] };
      let slug = slugOf(w) || "word";
      seen[slug] = (seen[slug] || 0) + 1;
      if (seen[slug] > 1) slug += "-" + seen[slug];
      const o = { id: words.length, w, m, a, src: (e.source || "").replace(/^المصدر:\s*/, ""), slug, s: surahs[si] };
      words.push(o);
      surahs[si].words.push(o);
    });
  });
  cache = { t: Date.now(), words };
  return cache;
}

function page(o) {
  const more = o.s.words.filter((x) => x.id !== o.id);
  const desc = esc(`معنى كلمة «${o.w}» في سورة ${o.s.name}: ${o.m}`.slice(0, 155));
  const ld = JSON.stringify({ "@context": "https://schema.org", "@type": "DefinedTerm", name: o.w, description: o.m, inDefinedTermSet: "غريب القرآن" }).replace(/</g, "\\u003c");
  const ay = "﴿" + o.a.segments.map((g) => esc(g.before) + "<mark>" + esc(g.hl) + "</mark>" + esc(g.after)).join(" … ") + "﴾";
  const chips = more.map((x) => `<a class="g pill q" style="font-size:20px" href="/word/${encodeURIComponent(x.slug)}.html">${esc(x.w)}</a>`).join("");
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>معنى ${esc(o.w)} في سورة ${esc(o.s.name)} | غريب القرآن</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${SITE}/word/${encodeURIComponent(o.slug)}.html">
<meta property="og:type" content="article"><meta property="og:title" content="معنى ${esc(o.w)} | غريب القرآن"><meta property="og:description" content="${desc}"><meta property="og:image" content="${SITE}/og-image.png">
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link href="https://fonts.googleapis.com/css2?family=Amiri+Quran&family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/site.css">
<script type="application/ld+json">${ld}</script>
</head>
<body>
<div id="bg"><i class="b1"></i><i class="b2"></i></div>
<main id="app">
<div class="top"><a class="logo" href="/">غريب القرآن</a><a class="g pill" href="/">كل الكلمات</a></div>
<a class="sm" href="/#/s/${o.s.no}">› سورة ${esc(o.s.name)}</a>
<div style="text-align:center;margin:10px 0 18px"><div class="sm">سورة ${esc(o.s.name)} · آية ${esc(o.a.label)}</div><h1 class="q big" style="font-weight:400;margin:0">${esc(o.w)}</h1></div>
<div class="g c2"><div class="sm">المعنى</div><div class="mn">${esc(o.m)}</div></div>
<div class="g c2"><div class="sm">الآية</div><div class="q ay">${ay}</div></div>
<div class="sm">المصدر: ${esc(o.src)}</div>
<div class="acts"><a class="pill btn" href="/#/w/${o.id}">افتح في التطبيق</a><a class="g pill" href="/#/quiz">اختبر نفسك</a></div>
${more.length ? `<div class="sm" style="margin:18px 0 10px">كلمات أخرى من سورة ${esc(o.s.name)}</div><div class="chips">${chips}</div>` : ""}
</main>
<script src="/theme.js"></script>
</body>
</html>`;
}

function sitemap(d) {
  const urls = [SITE + "/"].concat(d.words.map((o) => SITE + "/word/" + encodeURIComponent(o.slug) + ".html"));
  const day = new Date().toISOString().slice(0, 10);
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u, i) => `<url><loc>${u}</loc><lastmod>${day}</lastmod><priority>${i === 0 ? "1.0" : "0.6"}</priority></url>`).join("\n") + "\n</urlset>\n";
}

exports.seo = onRequest({ region: "europe-west1", memory: "256MiB", maxInstances: 5 }, async (req, res) => {
  try {
    const d = await load();
    if (req.path === "/sitemap.xml") {
      res.set("Cache-Control", "public, max-age=300, s-maxage=900").type("application/xml").send(sitemap(d));
      return;
    }
    const m = /^\/word\/(.+?)(?:\.html)?$/.exec(req.path);
    const slug = m && decodeURIComponent(m[1]);
    const o = slug && d.words.find((x) => x.slug === slug);
    if (!o) {
      res.status(404).set("Cache-Control", "public, max-age=60").type("html")
        .send('<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>غير موجود</title><p dir="rtl" style="font-family:sans-serif;padding:40px">الصفحة غير موجودة. <a href="/">الرئيسية</a></p>');
      return;
    }
    res.set("Cache-Control", "public, max-age=60, s-maxage=300").type("html").send(page(o));
  } catch (e) {
    console.error(e);
    res.status(500).set("Cache-Control", "no-store").send("خطأ مؤقت، حاول بعد قليل.");
  }
});
