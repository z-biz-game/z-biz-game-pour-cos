// Shape of the build: which layer may touch which API, and what is allowed to exist at all.
//
// These are not style preferences. Three of the project's rules are only enforceable by
// looking at the files: the core must stay free of DOM globals (that is what lets node
// certify the puzzles and the tests import the same modules), the app must ship with zero
// dependencies, and every pixel must come from canvas 2D because there are no image assets
// to fall back on. A comment that promises a file which does not exist is the same class of
// defect — it is a claim the next maintainer cannot check — so the last row walks every
// `test/…` mention in the tree and demands the file be there.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, ok, eq, run } from '../tools/harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, filter) {
  const out = [];
  const stack = [join(root, dir)];
  let guard = 0;
  while (stack.length) {
    if (++guard > 5000) throw new Error('walk: too many directories');
    const here = stack.pop();
    for (const entry of readdirSync(here)) {
      if (entry === '.git' || entry === 'node_modules' || entry === '.DS_Store') continue;
      const full = join(here, entry);
      if (statSync(full).isDirectory()) stack.push(full);
      else if (filter(full)) out.push(relative(root, full).split(sep).join('/'));
    }
  }
  return out.sort();
}

const CORE = walk('js/core', (f) => f.endsWith('.js'));
const APP = walk('js', (f) => f.endsWith('.js'));
const ALL = walk('.', (f) => !f.startsWith('memory/'));

// ---------- 1. the core layer has no DOM ----------

test('js/core/* contains no DOM global at all', () => {
  ok(CORE.length >= 8, `the core is ${CORE.length} modules: ${CORE.join(' ')}`);
  const leaks = [];
  for (const file of CORE) {
    const src = readFileSync(join(root, file), 'utf8');
    for (const needle of ['window.', 'document.', 'navigator.', 'alert(', 'localStorage.getItem', 'requestAnimationFrame', 'getContext', 'canvas']) {
      if (src.includes(needle)) leaks.push(`${file}: ${needle}`);
    }
  }
  eq(leaks, [], 'every rule/solver/storage module runs in node with no globals installed');
});

test('storage.js reaches the disk through globalThis, and only there', () => {
  const src = readFileSync(join(root, 'js/core/storage.js'), 'utf8');
  eq((src.match(/globalThis\.localStorage/g) || []).length, 1, 'exactly one place touches the browser at all');
  ok(src.includes('catch'), 'and it is inside a try, because localStorage throws rather than returning null');
  ok(!src.includes('window.'), 'no window.* in the module the tests import');
});

// ---------- 2. zero dependencies ----------

test('the package depends on nothing', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  eq(pkg.dependencies, {}, 'dependencies must be an empty object');
  eq(pkg.devDependencies, {}, 'devDependencies must be an empty object');
  eq(existsSync(join(root, 'node_modules')), false, 'and there is no node_modules to smuggle one in');
  eq(existsSync(join(root, 'package-lock.json')), false, 'no lockfile either — nothing to install');
  const imports = [];
  for (const file of [...APP, ...walk('tools', (f) => f.endsWith('.mjs')), ...walk('test', (f) => f.endsWith('.mjs')), 'server.cjs']) {
    const src = readFileSync(join(root, file), 'utf8');
    for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
      const spec = m[1];
      if (!spec.startsWith('.') && !spec.startsWith('node:')) imports.push(`${file}: ${spec}`);
    }
  }
  eq(imports, [], 'every import is relative or a node: builtin — there is no resolver to satisfy');
});

// ---------- 3. nothing that is not text ----------

test('the app ships no binary asset beyond the install icons', () => {
  const banned = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.mp3', '.wav', '.ogg',
    '.woff', '.woff2', '.ttf', '.otf', '.eot', '.wasm', '.zip', '.webm', '.mp4'];
  // 唯一的例外是 icons/ 下的**安装图标集**（标签页、PWA 安装、iOS 主屏都要位图，清单闸的 P 段还要拿 IHDR 真宽高去对账）。
  // 这个例外不是「往 icons/ 里塞什么都行」——它的边界由下面那条测试逐项钉死：
  // 只允许 PNG、必须被 manifest 或页面真的引用、每张都得是真 PNG。
  const found = ALL.filter((f) => !(f.startsWith('icons/') && f.toLowerCase().endsWith('.png'))
    && banned.some((ext) => f.toLowerCase().endsWith(ext)));
  eq(found, [], 'every visual is drawn by js/view.js with canvas 2D paths; only the install icons are bitmaps');
  // 这条量的是"有没有一段真资产跟着这个 scheme 走进文本文件"，不是前缀本身：tools/deploy-set.mjs 要**说出**
  // data:image/png;base64 这个名字（它把图标核 IHDR 真宽高），那不算走私资产；门槛取 64 个 base64 字符（≈48 字节）。
  const inline = ALL.filter((f) => /\.(js|mjs|css|html|cjs)$/.test(f)
    && /data:(image|audio|font|application\/octet-stream);base64,[A-Za-z0-9+/]{64,}/.test(readFileSync(join(root, f), 'utf8')));
  eq(inline, [], 'and nothing carries a real base64 asset behind a data: URI either');
});

test('the install icon set is exactly the set the manifest and the page name', () => {
  // 「零二进制资产」这条仓形约束的例外必须是**可机器判定的事实**，不是一句声明
  // （标准 §4.2：那种豁免必须有一条可机器判定的声明才成立，否则任何一句注释都能点亮它）。
  // 这里把它落成三条：① icons/ 下只准有 PNG；② 每一张都被 manifest 或页面真的引用（没有"多塞一张"的口子）；
  // ③ 每一张都是**真 PNG**（PNG 签名，不是把文本文件改个后缀）。尺寸逐张对账由 tools/deploy-set.mjs 的 P 段负责。
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const iconFiles = ALL.filter((f) => f.startsWith('icons/'));
  eq(iconFiles.filter((f) => !f.toLowerCase().endsWith('.png')), [],
    'icons/ holds PNGs and nothing else — no mp4, no webp, no stray binary');
  const named = new Set((manifest.icons || []).map((i) => i.src));
  for (const m of html.matchAll(/<link[^>]*>/g)) {
    const tag = m[0];
    if (!/rel=["'](?:icon|apple-touch-icon)["']/.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/);
    if (href) named.add(href[1]);
  }
  eq([...named].filter((f) => !iconFiles.includes(f)), [],
    'every icon the manifest or the page names is a real file under icons/');
  eq(iconFiles.filter((f) => !named.has(f)), [],
    'and no bitmap sits in icons/ unreferenced — the exception is exactly the install set');
  const fake = iconFiles.filter((f) => {
    const head = readFileSync(join(root, f)).subarray(0, 8);
    return !(head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47);
  });
  eq(fake, [], 'each of them starts with the PNG signature — a renamed text file does not pass');
  ok(existsSync(join(root, 'tools', 'make-icons.py')),
    'and the set is generated by a committed generator (tools/make-icons.py), not hand-dropped binaries');
});

test('the page loads nothing from a network', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  eq(/(src|href)\s*=\s*["']https?:/i.test(html), false, 'no remote script, stylesheet or font tag');
  const css = readFileSync(join(root, 'css', 'game.css'), 'utf8');
  eq(/url\(\s*['"]?(https?:|data:)/i.test(css), false, 'the stylesheet references no external or embedded resource');
  ok(/<link rel="icon" type="image\/png" sizes="32x32" href="icons\/favicon-32\.png">/.test(html), 'a real icon file is declared, so the browser asks for that one instead of /favicon.ico and logging a 404');
  ok(/<script[^>]+type="module"[^>]+src="js\/main\.js"/.test(html), 'the entry point is loaded as a module');
  ok(html.includes('<canvas'), 'the stage is a canvas element');
  ok(html.includes('name="viewport"'), 'and it is laid out for a phone first');
});

// ---------- 4. the shell is the only DOM layer ----------

test('the shell owns the DOM and routes through one hook', () => {
  const main = readFileSync(join(root, 'js/main.js'), 'utf8');
  ok(/window\.pour\s*=/.test(main), 'window.pour is the single global the browser tests drive');
  ok(main.includes("from './view.js'"), 'main.js is the only thing that imports the view');
  const view = readFileSync(join(root, 'js/view.js'), 'utf8');
  ok(view.includes("getContext('2d')") || view.includes('getContext("2d")'), 'the view draws with the 2D context');
  eq(/new Image\(|drawImage\(/.test(view), false, 'no bitmap decoding anywhere in the drawing code');
  eq(/fetch\(|XMLHttpRequest|import\(/.test(view + main), false, 'no runtime loading: the pool is a static module');
  for (const file of CORE) {
    eq(readFileSync(join(root, file), 'utf8').includes('view.js'), false, `${file} does not know the view exists`);
  }
});

// ---------- 5. the shipped pool is self-consistent about its own docs ----------

test('a file the source promises really exists', () => {
  const scanned = [...APP, ...walk('tools', (f) => /\.(mjs|cjs|js)$/.test(f)), ...walk('test', (f) => f.endsWith('.mjs')), 'index.html'];
  const missing = [];
  let mentions = 0;
  for (const file of scanned) {
    const src = readFileSync(join(root, file), 'utf8');
    for (const m of src.matchAll(/\b((?:js|tools|test|css)\/[\w./-]+\.(?:mjs|js|cjs|css|html))\b/g)) {
      mentions++;
      if (!existsSync(join(root, m[1]))) missing.push(`${file} promises ${m[1]}`);
    }
  }
  ok(mentions > 20, `${mentions} cross-file claims found — the sweep is actually looking`);
  eq(missing, [], 'no comment may advertise a file that is not in the tree');
});

test('the baked pool carries the numbers its header claims', () => {
  const src = readFileSync(join(root, 'js/data/lots.js'), 'utf8');
  const rows = src.split('\n').filter((l) => /^\s*\{"id":/.test(l));
  ok(rows.length >= 40, `${rows.length} puzzles shipped`);
  ok(/par.*BFS|measurements, not opinions/i.test(src), 'the header says where par comes from');
  ok(src.includes('test/library.test.mjs'), 'the header names the test that re-measures every line');
  eq(existsSync(join(root, 'test/library.test.mjs')), true, 'and that test exists');
});

// ---------- 6. the check scripts cover the files ----------

test('npm run check sees every source file that ships', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  ok(pkg.scripts.check.includes('js/*.js'), 'the shell modules');
  ok(pkg.scripts.check.includes('js/*/*.js'), 'core, data and anything one level down');
  ok(pkg.scripts.check.includes('tools/*.mjs') && pkg.scripts.check.includes('test/*.mjs'), 'the build tools and the tests');
  ok(pkg.scripts.check.includes('server.cjs') && pkg.scripts.check.includes('electron/main.cjs'), 'the two CommonJS entry points');
  const tooDeep = APP.filter((f) => f.split('/').length > 3);
  eq(tooDeep, [], 'no js file sits below the depth the glob covers, so nothing escapes the syntax check');
  const tools = walk('tools', (f) => /\.(mjs|cjs|sh)$/.test(f));
  for (const f of [...tools, ...walk('css', (x) => x.endsWith('.css'))]) ok(f.split('/').length === 2, `${f} is one level deep`);
  eq(pkg.scripts.unit, 'for f in test/*.test.mjs; do node "$f" || exit 1; done', 'npm run unit runs exactly the test suites');
  eq(pkg.scripts.test.includes('npm run check'), true, 'and npm test checks syntax first');
});

run();
