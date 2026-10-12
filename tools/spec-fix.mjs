// CSS that neutralizes artifacts of design-spec.html's own document chrome so the
// frames render the way the running app does.
//
// 1. The spec document defines `.sw` (inline 13px legend swatch) and `.lg` (language
//    button) for its own UI, after the frame styles, so they override the frames'
//    intended palette container `.sw` and challenge legend `.lg`. These overrides
//    restore the intended frame rules (the ones the app implements) inside `.frame`.
// 2. `.frame .wrap{height:100%;overflow:hidden}` makes the flex column shrink every
//    child once the content is taller than the frame (e.g. the search results page),
//    which compresses the search box from 54px to 33px. The real site scrolls
//    naturally, so pin children to their natural size; the frame still clips overflow.
export const SPEC_FIX = `.frame .sw{display:flex;flex-wrap:wrap;gap:14px 6px;justify-content:space-between;width:auto;height:auto;border:0;border-radius:0;vertical-align:baseline;margin:0}
.frame .lg{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:12px;color:var(--mu);position:static;inset:auto;border:0;background:none;border-radius:0;padding:0;cursor:default}
.frame .wrap>*{flex-shrink:0}`;
