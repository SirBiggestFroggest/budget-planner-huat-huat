/** Appends a build stamp to the page's own asset links, for the deploy only.
 *
 *      node tools/stamp-assets.mjs <stamp>
 *
 *  GitHub Pages serves everything with `Cache-Control: max-age=600`, so for ten
 *  minutes after a deploy a returning browser keeps using the stylesheet and
 *  bundle it already had. A fix can be live and correct while the person
 *  reporting it still sees the old behaviour — which is indistinguishable from
 *  the fix not working, and wastes everybody's time chasing it.
 *
 *  Rewriting `./app.css` to `./app.css?v=<sha>` changes the URL, so the browser
 *  has nothing cached under it and fetches the new file immediately.
 *
 *  This runs in CI against the checked-out copy, never against the working tree,
 *  so web/index.html stays clean in the repository.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = path.join(root, 'web', 'index.html');

const stamp = (process.argv[2] || String(Date.now())).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16);

// Only our own files. The Google Fonts URL already carries its own versioning,
// and rewriting a third-party link would just break it.
const LOCAL = /(src|href)="(\.\/[^"?#]+\.(?:js|css|png))"/g;

let html = fs.readFileSync(PAGE, 'utf8');
let count = 0;

html = html.replace(LOCAL, (_all, attr, url) => {
  count += 1;
  return `${attr}="${url}?v=${stamp}"`;
});

fs.writeFileSync(PAGE, html, 'utf8');
console.log(`stamp-assets: tagged ${count} asset links with ?v=${stamp}`);
