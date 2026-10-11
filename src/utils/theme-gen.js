const fs = require('fs');
const path = require('path');
const tokens = require('../../design/design-tokens.json');
const cssOut = path.join(__dirname, '../../public/theme.css');
function gen() {
  let css = '/* Generated from design/design-tokens.json - DO NOT EDIT */\n:root {\n';
  // minimal
  css += '}\n';
  fs.writeFileSync(cssOut, css);
}
gen();

