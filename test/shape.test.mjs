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

// 只走会进产物/进仓的目录。`_scratch/` 是本机排查用的副本（.gitignore 里有它），把它算进来
// 等于让上次调查留下的旧树参与本轮对账：树里多 14 张旧位图、旧 css 里的 data: 噪声都会
// 被当成"仓里的事实"。构建产物同理（_site/dist/.electron-cache）。
const SKIP_DIRS = new Set(['.git', 'node_modules', '_scratch', '_site', 'dist', '.electron-cache']);

function walk(dir, filter) {
  const out = [];
  const stack = [join(root, dir)];
  let guard = 0;
  while (stack.length) {
    if (++guard > 5000) throw new Error('walk: too many directories');
    const here = stack.pop();
    for (const entry of readdirSync(here)) {
      if (SKIP_DIRS.has(entry) || entry === '.DS_Store') continue;
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
  // 只查会出货的源，不查闸自己：`tools/deploy-set*.mjs` 必须把 `data:image/png` 写成字面量
  // 才认得出内联图标，拿同一张正则去查它只会把"抓贼的人"当成贼。`data:image/svg+xml` 是
  // studio.css 里那张程序化噪点（设计系统的一层底纹，不是位图资产），单独放行。
  const shipped = [...APP, ...walk('css', (f) => f.endsWith('.css')),
    'index.html', 'sw.js', 'server.cjs', 'electron/main.cjs'];
  const inline = shipped.filter((f) => /data:(?:image\/(?!svg\+xml)|audio|font|application\/octet-stream)/
    .test(readFileSync(join(root, f), 'utf8')));
  eq(inline, [], '也没有任何位图/字体/音频被塞成 data: URI');
});

test('every bitmap is referenced by something that ships, and every reference resolves', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const mf = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  const view = readFileSync(join(root, 'js/view.js'), 'utf8');
  const refs = new Set();
  // 社交卡的 og:image 必须是绝对 URL（抓取器不解析相对路径），所以这里按 URL 尾巴认，
  // 而不是按"以 assets/ 开头"认：`https://…/<repo>/assets/og/pour-og.png` 仍然对到盘上那张。
  for (const m of html.matchAll(/(?:href|content)\s*=\s*"([^"]+)"/g)) {
    const hit = /(?:^|\/)((?:icons|assets)\/[^"]+)$/.exec(m[1]);
    if (hit) refs.add(hit[1]);
  }
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
  ok(/property="og:image"[^>]+content="https:\/\/z-biz-game\.github\.io\/z-biz-game-pour-cos\/assets\/og\/pour-og\.png"/.test(html),
    'the social card points at the absolute Pages URL of a bitmap on disk');
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
  // 顺序即语义：先 fetch，网络挂了才 .catch，caches.match 只在 catch 里面。原来那条正则
  // 写死了 `fetch(req).then` 不能换行，链式排版一改就假红——这里改按出现位置判。
  const body = sw.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  const atFetch = body.indexOf('fetch(req)');
  const atCatch = atFetch < 0 ? -1 : body.indexOf('.catch(', atFetch);
  const atMatch = body.indexOf('caches.match(req)');
  ok(atFetch >= 0 && atFetch < atCatch && atCatch < atMatch,
    `网络优先，失败才回落缓存（fetch@${atFetch} catch@${atCatch} match@${atMatch}）`);
  eq(/respondWith\(caches\.match/.test(sw), false, '不是 cache-first：它会把 js 钉死在旧版');
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  // 注册逻辑在 js/sw-register.js 里（页面上是带 defer 的普通脚本，模块化入口不负责它）。
  // 判据仍要落在真代码上：http/https 才注册，file:// 下一条都不发。
  const reg = readFileSync(join(root, 'js/sw-register.js'), 'utf8');
  ok(html.includes('js/sw-register.js'), '注册脚本由页面加载');
  ok(/location\.protocol/.test(reg) && /https\?:/.test(reg), 'Electron 的 file:// 下不注册 SW（注册必失败并冒成控制台错误）');
  ok(/navigator\.serviceWorker\.register\(\s*['"]sw\.js['"]/.test(reg), '但 http/https 下确实注册');
});

test('the desktop shell points at a bitmap that exists', () => {
  // BrowserWindow 不带 icon 时，Windows/Linux 的 taskbar 与开发态 dock 一律退回 Electron
  // 默认图标；安装包同理。这两条引用过去没有任何测试看过，所以在这里钉住"路径写得出、
  // 文件在盘上、尺寸够"。
  const main = readFileSync(join(root, 'electron/main.cjs'), 'utf8');
  const m = /icon:\s*([A-Za-z_$][\w$]*)/.exec(main);
  ok(!!m, 'BrowserWindow 的构造参数里必须有 icon');
  const decl = new RegExp(`const ${m[1]}\\s*=\\s*path\\.join\\(__dirname,[^;]+`);
  ok(decl.test(main), `${m[1]} 必须由 __dirname 解析，不能是相对工作目录的字符串`);
  const lit = /path\.join\(__dirname,\s*'\.\.',\s*((?:'[^']+',?\s*)+)\)/.exec(main);
  ok(lit, '壳图标路径要写成 path.join(__dirname, \'..\', …) 的字面量段');
  const rel = [...lit[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).join('/');
  ok(existsSync(join(root, rel)), `壳引用的 ${rel} 必须在盘上`);
  const info = pngInfo(rel);
  ok(info.ok && info.w >= 512 && info.h >= 512, `壳图标要是不小于 512 的真 PNG，实测 ${info.w || '?'}x${info.h || '?'}`);
  ok(/app\.dock\.setIcon/.test(main), 'macOS 的 dock 图标走 app.dock.setIcon，不是窗口 option');

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const missing = [];
  for (const platform of ['mac', 'win', 'linux']) {
    const icon = pkg.build[platform] && pkg.build[platform].icon;
    if (!icon) missing.push(`${platform} 没有 icon 字段`);
    else if (!existsSync(join(root, icon))) missing.push(`${platform}.icon=${icon} 盘上不存在`);
    else if (icon !== 'icons/icon-1024.png') missing.push(`${platform}.icon 指向 ${icon}，与仓内那张 1024 不一致`);
  }
  eq(missing, [], '三个平台的安装包图标都指向仓内那张 1024 真 PNG');
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

test('the CI syntax step covers the same files as npm run check', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  const steps = ci.split('\n').map((l) => l.trim()).filter((l) => /^run:/.test(l)
    && /(?:node --check|npm run check)/.test(l));
  ok(steps.length >= 1, 'ci.yml 里有一行真的做语法检查');
  const grab = (s) => ((s.match(/for f in ([^;]+);/) || ['', ''])[1] || '').trim();
  // 两种写法都认：抄一份 glob（必须与 package.json 逐字相同），或直接 `npm run check`
  // （跑的就是同一份清单，比手抄更不容易漂）。少检一个文件＝本地绿、线上没人看。
  const inline = steps.filter((l) => grab(l) !== '' && grab(l) === grab(pkg.scripts.check));
  const viaNpm = steps.filter((l) => /^run:\s*npm run check\b/.test(l));
  ok(inline.length + viaNpm.length >= 1,
    `CI 语法步与 npm run check 不是同一份清单：${steps.join(' | ') || '（一行都没有）'}`);
  ok(pkg.scripts.check.includes('sw.js'), `npm run check 的清单是 ${grab(pkg.scripts.check)}`);
});

// ---------- 7. the thumb floor lands on controls that really exist ----------

test('每个真的会被点的控件都拿到 44px 命中区', () => {
  const css = readFileSync(join(root, 'css/game.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
  const bound = (sel, prop) => {
    let best = 0;
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!m[1].split(',').map((s) => s.trim()).includes(sel)) continue;
      for (const d of m[2].matchAll(new RegExp(`min-${prop}:\\s*(\\d+)px`, 'g'))) best = Math.max(best, Number(d[1]));
    }
    return best;
  };
  ok(bound('.touch', 'height') >= 44 && bound('.touch', 'width') >= 44, '.touch 那条规则本身要够 44px');

  const html = readFileSync(join(root, 'index.html'), 'utf-8').replace(/<!--[\s\S]*?-->/g, '');
  const main = readFileSync(join(root, 'js/main.js'), 'utf-8');
  const touches = [...html.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);
  eq(touches.length >= 12, true, `${touches.length} 个写死的按钮，太少说明页面结构变了却没来看这条`);
  for (const tag of touches) {
    const cls = (tag.match(/class="([^"]*)"/) || ['', ''])[1];
    ok(/(^|\s)touch(\s|$)/.test(cls), `页面上的 ${tag.slice(0, 56)} 没有 .touch，命中区没来源`);
  }
  ok(bound('.about summary', 'height') >= 44, '「关于」面板的 <summary> 也是点击目标');

  // 生成出来的按钮：类名是模板变量，靠容器规则兜住 —— 先确认它真的写进那个容器。
  const generated = [...main.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);
  ok(generated.length >= 4, `${generated.length} 个运行时生成的按钮`);
  const shelf = /el\.shelf\.innerHTML\s*=/.test(main);
  ok(shelf, '生成按钮的落点仍是 #shelf，规则名要跟着改');
  for (const tag of generated) {
    const cls = (tag.match(/class="([^"]*)"/) || ['', ''])[1];
    const covered = /(^|\s)touch(\s|$)/.test(cls)
      || (shelf && bound('.shelf button', 'height') >= 44 && bound('.shelf button', 'width') >= 44);
    ok(covered, `生成的 ${tag.slice(0, 56)} 既没 .touch，容器规则也没给 44px`);
  }
});

run();
