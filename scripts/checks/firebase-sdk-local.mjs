// The Firebase web SDK the admin loads, served from a vendored copy instead of downloaded from gstatic at test time
// (that download timed out on CI runners and failed unrelated runs). The three files in vendor/firebasejs-10.14.1/ are
// byte-identical to https://www.gstatic.com/firebasejs/10.14.1/ and to the firebase@10.14.1 npm package (Apache-2.0).
// Each is checked against its pinned SHA-256 before use, and the admin must still load this exact version, so a stale
// or altered copy fails loudly instead of testing the wrong code. ASCII only.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const VERSION = "10.14.1";
export const SDK = "https://www.gstatic.com/firebasejs/" + VERSION + "/";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, "vendor", "firebasejs-" + VERSION);
const PINNED = {
  "firebase-app.js": "19f05d67deadb1a1fba077c18611c3c9b2fdd5b4ebbd0a5e391498925ebae23e",
  "firebase-auth.js": "b51687c5729f9516e2e65cf3b4735a5a4d4bc707c7754221cc53cb9fd799c21a",
  "firebase-firestore.js": "39bd17897082983e072d4b99caa2ca2f2fbf9eac644bc613ff93cf59a9646b46",
};

const admin = fs.readFileSync(path.join(HERE, "..", "..", "public", "admin", "index.html"), "utf8");
if (!admin.includes(SDK)) throw new Error("firebase-sdk-local: the admin no longer loads " + SDK + "; update the vendored copy");

const cache = {};
export function sdk(name) {
  if (cache[name]) return cache[name];
  if (!PINNED[name]) throw new Error("firebase-sdk-local: no vendored copy of " + name);
  const b = fs.readFileSync(path.join(DIR, name));
  if (crypto.createHash("sha256").update(b).digest("hex") !== PINNED[name]) throw new Error("firebase-sdk-local: " + name + " does not match its pinned SHA-256");
  return (cache[name] = b);
}
