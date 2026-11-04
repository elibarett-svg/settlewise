/**
 * Pack the exported web demo (dist-demo/) into one self-contained HTML file,
 * dist-demo/settlewise-demo.html, for hosting where a page may not load its own
 * script, stylesheet or font files: the bundle and styles are inlined and the icon
 * font is embedded as a data URI (registered by app/_layout.tsx).
 *
 * Run through `npm run demo:web`.
 */
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist-demo');
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const local = (url) => path.join(dist, decodeURIComponent(url.split('?')[0]).replace(/^\//, ''));
const safeScript = (code) => code.replace(/<\/script/gi, '<\\/script');

html = html.replace(/<script\s+src="([^"]+)"[^>]*><\/script>/g, (_, src) => `<script>${safeScript(fs.readFileSync(local(src), 'utf8'))}</script>`);
html = html.replace(/<link\s+rel="stylesheet"\s+href="([^"]+)"[^>]*>/g, (_, href) => `<style>${fs.readFileSync(local(href), 'utf8')}</style>`);
html = html.replace(/<link\s+rel="(?:icon|shortcut icon)"[^>]*>/g, '');

const font = require.resolve('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf');
const fonts = { ionicons: `data:font/ttf;base64,${fs.readFileSync(font).toString('base64')}` };
html = html.replace('<head>', `<head>\n<script>window.__SETTLEWISE_FONTS__ = ${JSON.stringify(fonts)};</script>`);
html = html.replace(/<title>[^<]*<\/title>/, '<title>SettleWise Demo</title>');

const out = path.join(dist, 'settlewise-demo.html');
fs.writeFileSync(out, html);
const leftover = html.match(/(?:src|href)="\/[^"]+"/g);
console.log(`Wrote ${out} (${(html.length / 1048576).toFixed(1)} MiB)`);
if (leftover) console.warn('Still references external files:', leftover);
