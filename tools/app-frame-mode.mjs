// App-side counterpart of the spec's frame overrides.
//
// The spec renders each screen inside `.frame`, which is `position:relative`, and then
// overrides the real fixed-position elements to absolute so they stay inside the frame:
//   .frame nav{position:absolute}
//   .frame .bgx i{position:absolute}
//   .frame .ld{position:absolute}
//   .frame .shx{position:absolute;inset:0}
//
// The running app keeps those elements fixed to the viewport (correct on a device). When
// a tablet/desktop frame is taller than the viewport, a full-page screenshot of the app
// therefore renders them at the wrong vertical position, which shows up as a large diff
// that is not a layout bug. Injecting the same override (with `body` as the positioned
// ancestor, the analog of `.frame`) makes the full-page comparison faithful to what the
// design frame depicts. Only used for the tablet/desktop viewports; the mobile frame is
// exactly viewport-sized, where fixed and absolute already coincide.
export const APP_FRAME_MODE = `body{position:relative}
#bg{position:absolute;inset:0;overflow:hidden}
#bg i{position:absolute}
nav{position:absolute}
/* The spec's sheet frames draw no floating nav (the modal covers the page chrome);
   hide it here so the sheet comparison matches the depicted state. Only active on
   the sheet screen, where #sh gets .open. */
body:has(#sh.open) nav{display:none}
.ld{position:absolute}
#sh{position:absolute}`;
