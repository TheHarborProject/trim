import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/react/shell/vanilla-popover.tsx", import.meta.url), "utf8");
const dialogSource = readFileSync(new URL("../src/react/shell/vanilla-dialog.tsx", import.meta.url), "utf8");

assert.match(source, /aria-labelledby=\{`\$\{popoverId\}-title`\}/);
assert.match(source, /data-trim-shell-header/);
assert.match(source, /data-trim-shell-title/);
assert.match(source, /id=\{`\$\{popoverId\}-title`\}/);
assert.match(source, /\{label\}/);
assert.doesNotMatch(source, /⚙/);
assert.doesNotMatch(dialogSource, /⚙/);

console.log("PASS vanilla popover markup: labelled header, generated title id, coherent text launcher, no icon dependency");
