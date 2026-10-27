# Official Hafs text

`hafsData_v2-0.json` is the Hafs text published by the King Fahd Glorious Quran Printing Complex, committed exactly as
downloaded (not edited in any way).

- Package: `UthmanicHafs_v2-0.zip`, from the Complex's developer service:
  `https://download.qurancomplex.gov.sa/resources_dev/UthmanicHafs_v2-0.zip`
  (server Last-Modified 2023-09-19; package SHA-256 `a7b0e5591945712ec5e4d6142938ae4d1e9b49bdc89dff06222789bfebdfd72c`).
- File in the package: `UthmanicHafs_v2-0 data/hafsData_v2-0.json` (data version 2.0, 2022-09-07),
  SHA-256 `d2960b3217962e7e4252abdcece67bea3d6b48271e4cd3af45bbbb2dd5c872ca`. 6236 rows, one per ayah, with
  `sura_no` and `aya_no`.
- Downloaded 2026-10-27.

Why this package: its `aya_text` is in the encoding the site stores and the KFGQPC Uthmanic Hafs v22 font draws
(U+06E1 sukun; open tanween U+0657 / U+065E / U+0656). It is the same text as the v22 font's own text file
(`UthmanicHafs v22.json` as mirrored by github.com/nuqayah/qpc-fonts at 8a4f39d), except that the Complex's file puts
a no-break space after the hizb mark U+06DE in 199 ayat. The Complex's current download, `kfgqpc_hafs_v30.zip`
(2026-09-30), uses the standard open-tanween code points U+08F0-U+08F2 for a newer font, so it does not match the
stored text or the v22 font.

`index.js` returns the text by (surah, ayah). When reading it removes, in memory only, the trailing space and
ayah-number glyph of each `aya_text`, and turns the no-break spaces into ordinary spaces. `fix.js` rebuilds a
failing segment of the site's data from this text. `scripts/build-quran-ref.mjs` writes the admin's copy,
`public/admin/quran-hafs.json`.
