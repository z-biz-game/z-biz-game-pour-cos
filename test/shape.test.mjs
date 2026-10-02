// Shape of the build: which layer may touch which API, and what is allowed to exist at all.
//
// These are not style preferences. The rules are only enforceable by looking at the files:
// the core must stay free of `window`/`document` (that is what lets node certify the puzzles
// and the tests import the same modules), the app must ship with zero dependencies, and every
// bitmap must be a real PNG that the committed generator can rebuild — the renderer is still
// canvas 2D, but the bench texture, the droplet sheet and the store icons are pixels on disk,
// so "a page that references a missing asset" is now the failure mode worth pinning. A comment
// that promises a file which does not exist is the same class of defect — it is a claim the
// next maintainer cannot check — so the last rows walk the tree and demand the file be there.

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
    for (const needle of ['window.', 'document.', 'navigator.', 'alert(', 'requestAnimationFrame', 'getContext', 'canvas']) {
      if (src.includes(needle)) leaks.push(`${file}: ${needle}`);
    }
  }
  eq(leaks, [], 'every rule/solver module runs in node with no globals installed');
  // The save file is the one core module allowed to name the browser disk, and it has to name
  // it *literally*: a handle wrapper hides the call from grep and from the sellability audit
  // alike, and `store.records` reading back what was written is a claim about getItem/setItem.
  const naming = CORE.filter((f) => /localStorage\.\w/.test(readFileSync(join(root, f), 'utf8')));
  eq(naming, ['js/core/storage.js'], 'localStorage is called by name in exactly one core module');
});

test('storage.js looks the disk up once and calls it only under a guard', () => {
  const src = readFileSync(join(root, 'js/core/storage.js'), 'utf8');
  eq((src.match(/globalThis\.localStorage/g) || []).length, 1, 'one availability probe, in available()');
  const calls = src.match(/\blocalStorage\.\w+/g) || [];
  eq([...new Set(calls)].sort(), ['localStorage.getItem', 'localStorage.removeItem', 'localStorage.setItem'],
    'read, write and wipe are all really called — not one write-only save');
  ok((src.match(/try \{/g) || []).length >= calls.length,
    `every call site sits in its own try (${calls.length} calls, ${(src.match(/try \{/g) || []).length} guards), because storage throws rather than returning null`);
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

// ---------- 3. what is allowed to exist, and who asks for it ----------

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Read from the bytes, never from the filename: a hand-saved "icon-192.png" that is really a
// 1x1, or an SVG renamed to .png, is exactly the placeholder this repo must not ship.
function pngInfo(rel) {
  const buf = readFileSync(join(root, rel));
  if (!buf.subarray(0, 8).equals(PNG_MAGIC)) return { ok: false, why: '不是 PNG 签名' };
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (w < 16 || h < 16) return { ok: false, why: `IHDR ${w}x${h} 小到像占位` };
  // 16px favicon 真画出来也只有 300 多字节，所以底线只挡得住空壳与 1x1 占位。
  if (buf.length < 128) return { ok: false, why: `${buf.length} 字节：这是个空壳` };
  return { ok: true, w, h, bytes: buf.length };
}

const BITMAPS = ALL.filter((f) => /\.(png|jpg|jpeg|gif|webp|ico|svg|mp3|wav|ogg|woff2?|ttf|otf|eot|wasm|zip|webm|mp4)$/.test(f));

test('every bitmap in the tree is a real PNG the generator can rebuild', () => {
  const notPng = BITMAPS.filter((f) => !f.toLowerCase().endsWith('.png'));
  eq(notPng, [], '没有第二种容器：svg 冒充 png、字体与音频都不许进仓');
  ok(BITMAPS.length >= 14, `${BITMAPS.length} 张位图入库`);
  const broken = BITMAPS.map((f) => ({ f, info: pngInfo(f) })).filter((r) => !r.info.ok);
  eq(broken.map((r) => `${r.f} ${r.info.why}`), [], '每张都能解出 IHDR，且不是空壳');
  const big = BITMAPS.filter((f) => { const i = pngInfo(f); return i.ok && Math.min(i.w, i.h) >= 180; });
  ok(big.length >= 5, `最小边 ≥180 的图标 ${big.length} 张：${big.join(' ')}`);
  eq(existsSync(join(root, 'assets/gen/gen_art.py')), true, '生成器随仓提交，资产不是二手图');
  const gen = readFileSync(join(root, 'assets/gen/gen_art.py'), 'utf8');
  for (const dir of ['icons/', 'assets/og/', 'assets/sprites/', 'assets/textures/']) {
    ok(gen.includes(dir), `生成器自己写出 ${dir}`);
  }
  const inline = ALL.filter((f) => /\.(js|mjs|css|html|cjs)$/.test(f)
    && /data:(image|audio|font|application\/octet-stream)/.test(readFileSync(join(root, f), 'utf8')));
  eq(inline, [], '也没有任何资源被塞成 data: URI');
});

test('every bitmap is referenced by something that ships, and every reference resolves', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const mf = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  const view = readFileSync(join(root, 'js/view.js'), 'utf8');
  const refs = new Set();
  for (const m of html.matchAll(/(?:href|content)\s*=\s*"((?:icons|assets)\/[^"]+)"/g)) refs.add(m[1]);
  for (const icon of mf.icons) refs.add(icon.src);
  for (const m of view.matchAll(/['"]((?:assets|icons)\/[^'"]+\.png)['"]/g)) refs.add(m[1]);
  eq([...refs].filter((r) => !existsSync(join(root, r))), [], `${refs.size} 条引用全部落在盘上`);
  eq(BITMAPS.filter((f) => !refs.has(f)), [], '没有孤儿位图：每张都被页面、manifest 或渲染器用到');
  const lied = mf.icons.filter((i) => {
    const info = pngInfo(i.src);
    return !info.ok || i.sizes !== `${info.w}x${info.h}`;
  });
  eq(lied.map((i) => `${i.src} 声明 ${i.sizes}`), [], 'manifest 里的 sizes 是真实 IHDR，不是愿望');
});

test('the page loads nothing from a network', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  eq(/(src|href)\s*=\s*["']https?:/i.test(html), false, 'no remote script, stylesheet or font tag');
  const css = readFileSync(join(root, 'css', 'game.css'), 'utf8');
  eq(/url\(\s*['"]?(https?:|data:)/i.test(css), false, 'the stylesheet references no external or embedded resource');
  // 这一行原本要求的是 `<link rel="icon" href="data:,">` —— 一个为了压掉 /favicon.ico 404
  // 的空占位。现在图标是真的，占位必须消失，否则等于把 404 又请回来。注释里提它不算数，
  // 所以先把注释剥掉再查标签。
  const tags = html.replace(/<!--[\s\S]*?-->/g, '');
  eq(tags.includes('href="data:,"'), false, 'the empty data:, favicon placeholder is gone');
  ok(/<link rel="icon"[^>]+sizes="32x32"[^>]+href="icons\/favicon-32\.png"/.test(html), 'a real 32px favicon link');
  ok(/<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png">/.test(html), 'iOS home-screen icon');
  ok(/<link rel="manifest" href="manifest\.webmanifest">/.test(html), 'the install manifest is linked from the page');
  ok(/property="og:image"[^>]+content="assets\/og\/pour-og\.png"/.test(html), 'the social card points at a bitmap on disk');
  ok(/<script[^>]+type="module"[^>]+src="js\/main\.js"/.test(html), 'the entry point is loaded as a module');
  ok(html.includes('<canvas'), 'the stage is a canvas element');
  ok(html.includes('name="viewport"'), 'and it is laid out for a phone first');
});

test('the install surface is a real manifest plus a network-first service worker', () => {
  const mf = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  for (const key of ['name', 'short_name', 'description', 'start_url', 'scope', 'display', 'icons']) {
    ok(mf[key] !== undefined && mf[key] !== '', `${key} 必须真的填了，Chrome 只认这一项`);
  }
  ok(mf.icons.some((i) => /^\d{3,}x\d{3,}$/.test(i.sizes)), '至少一个三位数尺寸的图标');
  ok(mf.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512'), 'Android 自适应图标要有 maskable');
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  ok(/VERSION\s*=\s*'[\w-]+-v\d+'/.test(sw), '缓存名带版本号，activate 才换得掉整代');
  ok(/fetch\(req\)\.then[\s\S]*\.catch\([\s\S]*caches\.match/.test(sw), '网络优先，失败才回落缓存');
  eq(/respondWith\(caches\.match/.test(sw), false, '不是 cache-first：它会把 js 钉死在旧版');
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  ok(html.includes("location.protocol !== 'file:'"), 'Electron 的 file:// 下不注册 SW（注册必失败并冒成控制台错误）');
  ok(/navigator\.serviceWorker\.register/.test(html), '但 http/https 下确实注册');
});

// ---------- 4. the shell is the only DOM layer ----------

test('the shell owns the DOM and routes through one hook', () => {
  const main = readFileSync(join(root, 'js/main.js'), 'utf8');
  ok(/window\.pour\s*=/.test(main), 'window.pour is the single global the browser tests drive');
  ok(main.includes("from './view.js'"), 'main.js is the only thing that imports the view');
  const view = readFileSync(join(root, 'js/view.js'), 'utf8');
  ok(view.includes("getContext('2d')") || view.includes('getContext("2d")'), 'the view draws with the 2D context');
  const paths = (view.match(/\bctx\.(?:beginPath|moveTo|lineTo|arc|roundRect|quadraticCurveTo|rect|fill|fillRect|stroke|strokeRect)\(/g) || []).length;
  ok(paths >= 30, `${paths} 次 2D 路径/填充调用：桶、水面、刻度、水柱仍是矢量画的，贴图只是底`);
  // 位图只允许是仓内相对路径（test 3 已逐条验证它们在盘上且被引用），不许有远程图源。
  const images = [...view.matchAll(/['"]((?:assets|icons|https?:|data:)[^'"]*\.png)['"]/g)].map((m) => m[1]);
  ok(images.length >= 2, `${images.length} 张贴图/精灵由渲染器加载`);
  eq(images.filter((s) => /^(https?:)?\/\//.test(s) || s.startsWith('/')), [], 'no remote or absolute bitmap source in the view');
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
  ok(pkg.scripts.check.includes('sw.js'), 'the service worker is shipped source, not a stray file');
  ok(pkg.scripts.check.includes('tools/*.mjs') && pkg.scripts.check.includes('test/*.mjs'), 'the build tools and the tests');
  ok(pkg.scripts.check.includes('server.cjs') && pkg.scripts.check.includes('electron/main.cjs'), 'the two CommonJS entry points');
  const tooDeep = APP.filter((f) => f.split('/').length > 3);
  eq(tooDeep, [], 'no js file sits below the depth the glob covers, so nothing escapes the syntax check');
  const tools = walk('tools', (f) => /\.(mjs|cjs|sh)$/.test(f));
  for (const f of [...tools, ...walk('css', (x) => x.endsWith('.css'))]) ok(f.split('/').length === 2, `${f} is one level deep`);
  eq(pkg.scripts.unit, 'for f in test/*.test.mjs; do node "$f" || exit 1; done', 'npm run unit runs exactly the test suites');
  eq(pkg.scripts.test.includes('npm run check'), true, 'and npm test checks syntax first');
});

test('the CI syntax glob is the same list as npm run check', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  const line = ci.split('\n').find((l) => l.includes('node --check')) || '(ci.yml has no syntax step)';
  const grab = (s) => ((s.match(/for f in ([^;]+);/) || ['', ''])[1] || '').trim();
  eq(grab(line), grab(pkg.scripts.check), 'CI 少检一个文件，等于那个文件本地绿了线上没人看');
  ok(grab(line).includes('sw.js'), `the CI list is ${grab(line)}`);
});

run();
