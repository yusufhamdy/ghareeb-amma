/*
 * challenge-logic-parity.test.js
 *
 * The browser mirror of the challenge logic (public/admin/challenge-logic.js)
 * must behave identically to functions/challenge.js. On the free plan the admin
 * page runs the roulette and day validation in the browser; this test guards
 * against the two copies drifting (same pattern as normalize-parity.test.js).
 *
 * ASCII-only.
 */
const { test } = require("node:test");
const assert = require("node:assert");

const fn = require("../functions/challenge");
const client = require("../public/admin/challenge-logic");

const POOLS = [
  [],
  [[114, "a"]],
  [[114, "a"], [113, "b"], [113, "c"]],
  [[1, "x"], [2, "y"], [3, "x"]],
];

test("rouletteSelect parity across pools, randoms and avoid", () => {
  const randoms = [0, 0.0001, 0.25, 0.5, 0.75, 0.999999, 1, -1, 2, NaN];
  for (const pool of POOLS) {
    for (const r of randoms) {
      const random = () => r;
      assert.deepStrictEqual(
        client.rouletteSelect(pool, { random }),
        fn.rouletteSelect(pool, { random }),
        "mismatch pool=" + JSON.stringify(pool) + " r=" + r
      );
    }
  }
});

test("rouletteSelect parity with avoid and spinId", () => {
  const pool = [[114, "a"], [113, "b"], [113, "c"]];
  for (const r of [0, 0.4, 0.99]) {
    const opts = { random: () => r, avoid: [114, "a"], spinId: "d1" };
    assert.deepStrictEqual(client.rouletteSelect(pool, opts), fn.rouletteSelect(pool, opts));
  }
});

test("rouletteSelect parity with a deterministic random sequence", () => {
  const pool = [[1, "a"], [2, "b"], [3, "c"], [4, "d"], [5, "e"]];
  const seq = [0.1, 0.9, 0.33, 0.66, 0.01];
  const mk = () => {
    let i = 0;
    return () => seq[i++ % seq.length];
  };
  const a = [];
  const b = [];
  const ra = mk();
  const rb = mk();
  for (let k = 0; k < 8; k++) {
    a.push(client.rouletteSelect(pool, { random: ra }));
    b.push(fn.rouletteSelect(pool, { random: rb }));
  }
  assert.deepStrictEqual(a, b);
});

test("rouletteSelect parity never mutates the input pool", () => {
  const pool = [[1, "a"], [2, "b"]];
  const before = JSON.stringify(pool);
  client.rouletteSelect(pool, { random: () => 0.5 });
  fn.rouletteSelect(pool, { random: () => 0.5 });
  assert.strictEqual(JSON.stringify(pool), before);
});

test("validateDayReferences parity on the same state and resolver", () => {
  const state = {
    startDate: null,
    releasedUpTo: 2,
    days: [
      { d: 1, w: [[114, "a"], [113, "b"]], reel: "" },
      { d: 2, w: [[999, "missing"]], reel: "" },
      { d: 3, w: [], reel: "" },
    ],
  };
  const resolve = (ref) => ref[0] !== 999;
  assert.deepStrictEqual(
    client.validateDayReferences(state, resolve),
    fn.validateDayReferences(state, resolve)
  );
  assert.strictEqual(client.validateDayReferences(state, resolve).length, 1);
});

test("validateDayReferences parity handles missing state and no resolver", () => {
  assert.deepStrictEqual(client.validateDayReferences(null), fn.validateDayReferences(null));
  assert.deepStrictEqual(
    client.validateDayReferences({ days: [{ d: 1, w: [[1, "x"]] }] }),
    fn.validateDayReferences({ days: [{ d: 1, w: [[1, "x"]] }] })
  );
});

test("challenge wire shape: toTuples/toObjects round trip", () => {
  const objects = [
    { d: 1, w: [{ no: 114, word: "a" }, { no: 113, word: "b" }], reel: "https://x" },
    { d: 2, w: [], reel: "" },
  ];
  const tuples = [
    { d: 1, w: [[114, "a"], [113, "b"]], reel: "https://x" },
    { d: 2, w: [], reel: "" },
  ];
  // Firestore {no,word} objects -> UI tuples (normalising read).
  assert.deepStrictEqual(client.toTuples(objects), tuples);
  // UI tuples -> Firestore {no,word} objects (write back, never nested arrays).
  assert.deepStrictEqual(client.toObjects(tuples), objects);
  // Tuples pass through toTuples unchanged (demo/localStorage stays working).
  assert.deepStrictEqual(client.toTuples(tuples), tuples);
  // The write form must not contain nested arrays (Firestore forbids them).
  assert.strictEqual(JSON.stringify(client.toObjects(tuples)).includes("[["), false);
});
