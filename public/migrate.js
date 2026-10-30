/*
 * migrate.js - Phase 5B T4c: client reads application data from Firestore.
 *
 * The SPA (public/index.html) loads its data via fetch('words.json') /
 * fetch('challenge.json') but also honors the window.__WORDS__ / window.__CH__
 * overrides. This module plugs the Firestore read path in front of those
 * fetches without modifying any of the app's own code, so every Arabic byte
 * stays untouched:
 *
 *   - window.__DATA_SRC__ starts as 'pending', then becomes 'firestore' when
 *     the migrated documents (public/data, public/challenge) load, or 'json'
 *     when they are unavailable / the request errors. It is the single source
 *     of truth for the data source, checked by
 *     scripts/verify-client-firestore.mjs.
 *   - words.json / challenge.json are answered from the local files FIRST: the
 *     offline JSON path is always taken unless Firestore has already replied,
 *     so first render never waits on the network (offline-first).
 *   - Firestore is an optional background refresh: if the migrated documents
 *     (public/data, public/challenge) load, the globals are upgraded. If it is
 *     unreachable or the database does not exist, the module silently keeps the
 *     JSON data - no visible error to visitors (see DECISIONS-LOG.md).
 *   - ?emul=1 routes to the Firestore emulator at 127.0.0.1:8080 (isolated
 *     verification environment).
 *
 * Uses the modular Firebase JS SDK (app + firestore) at the exact version the
 * verification harness serves.
 */
(function () {
  'use strict';
  window.__DATA_SRC__ = 'pending';
  var realFetch = window.fetch.bind(window);
  var SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';

  function buildChallenge(challenge) {
    var days = (challenge && challenge.days ? challenge.days : []).map(function (d) {
      var day = {
        d: Number(d.d),
        w: (d.w || []).map(function (r) {
          if (Array.isArray(r)) return [Number(r[0]), r[1]];
          return [Number(r.no), r.word];
        }),
        reel: d.reel || '',
      };
      // the per-platform video links the admin saves (only when set; the app checks each link's host)
      ['reelIg', 'reelTt', 'reelYt'].forEach(function (k) {
        if (typeof d[k] === 'string' && d[k]) day[k] = d[k];
      });
      return day;
    });
    return {
      startDate: challenge ? (challenge.startDate == null ? null : challenge.startDate) : null,
      releasedUpTo: challenge ? (challenge.releasedUpTo == null ? null : challenge.releasedUpTo) : null,
      days: days,
    };
  }

  // Flip-flop guard for the optional background refresh: first render never
  // waits on Firestore, so a reply that arrives late may still upgrade the
  // globals, but only once, and it can never put a payload the app did not ask
  // for in front of the JSON it already rendered.
  var firestoreOk = false;

  function finish(data, challenge) {
    if (firestoreOk) return false;
    firestoreOk = true;
    // The app's build() consumes the JSON words shape, which is a plain ARRAY of
    // surahs (public/words.json). The Firestore document wraps that array as
    // { rev, surahs }, so unwrap it here to keep the app (and every Arabic byte)
    // unchanged.
    window.__WORDS__ = Array.isArray(data) ? data : data.surahs;
    window.__CH__ = buildChallenge(challenge);
    window.__DATA_SRC__ = 'firestore';
    return true;
  }

  function loadFromFirestore() {
    var cfg = window.FIREBASE_CONFIG;
    if (!cfg || !cfg.projectId) {
      window.__DATA_SRC__ = 'json';
      return Promise.resolve(false);
    }
    var params = new URLSearchParams(window.location.search || '');
    var useEmul = params.get('emul') === '1';
    // The Firestore emulator namespaces data per project id. The seed script
    // (scripts/seed-emulator.js) writes to the `demo-ghareeb` demo project, so
    // in emulator mode the client must read that same namespace rather than the
    // production project id it uses in real deployments.
    var appCfg = useEmul ? Object.assign({}, cfg, { projectId: 'demo-ghareeb' }) : cfg;
    var attempt = Promise.all([
      import(SDK + 'firebase-app.js'),
      import(SDK + 'firebase-firestore.js'),
    ]).then(function (mods) {
      var appMod = mods[0];
      var fsMod = mods[1];
      var app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(appCfg);
      var db = fsMod.getFirestore(app);
      if (useEmul) {
        try { fsMod.connectFirestoreEmulator(db, '127.0.0.1', 8080); } catch (e) { /* already connected */ }
      }
      return Promise.all([
        fsMod.getDoc(fsMod.doc(db, 'public', 'data')),
        fsMod.getDoc(fsMod.doc(db, 'public', 'challenge')),
      ]).then(function (snaps) {
        var data = snaps[0].exists() ? snaps[0].data() : null;
        var challenge = snaps[1].exists() ? snaps[1].data() : null;
        var surahs = data && (Array.isArray(data) ? data : data.surahs);
        if (!Array.isArray(surahs) || surahs.length === 0) return false;
        return finish(data, challenge);
      });
    }).catch(function () {
      return false;
    });

    // Bounded wait: Firestore is an OPTIONAL background refresh. If it cannot
    // answer within 800ms (unreachable or no database exists), declare JSON the
    // source silently and keep the local data - no visible error to visitors.
    // This promise is never awaited by window.fetch below, so the page can not
    // block on Firestore; a reply arriving after the deadline still upgrades
    // the globals via finish() without delaying first render.
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        window.__DATA_SRC__ = 'json';
        resolve(false);
      }, 800);
      attempt.then(function (ok) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (ok) resolve(true);
        else {
          if (window.__DATA_SRC__ === 'pending') window.__DATA_SRC__ = 'json';
          resolve(false);
        }
      });
    });
  }

  // Offline-first: started in the background and NEVER awaited by the fetch
  // hook below, so the SPA renders from the local words.json/challenge.json
  // immediately even when Firestore is unreachable or unprovisioned.
  loadFromFirestore().catch(function () {
    if (window.__DATA_SRC__ === 'pending') window.__DATA_SRC__ = 'json';
    return false;
  });

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url);
    if (typeof url === 'string' && (url.indexOf('words.json') !== -1 || url.indexOf('challenge.json') !== -1)) {
      if (firestoreOk) {
        var isWords = url.indexOf('words.json') !== -1;
        var payload = isWords ? window.__WORDS__ : window.__CH__;
        return Promise.resolve({
          ok: true,
          status: 200,
          url: url,
          json: function () { return Promise.resolve(payload); },
          text: function () { return Promise.resolve(JSON.stringify(payload)); },
        });
      }
      // Firestore has not answered yet: serve the local file now, never wait.
      return realFetch(input, init);
    }
    return realFetch(input, init);
  };
})();
