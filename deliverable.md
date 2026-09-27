# 倒水量 - 交付报告

读者：接手的维护者代理。本文件只登记**磁盘上真实存在、且在本次会话里被命令跑绿过**的东西；
每条声称都指到一个具体文件与一条能跑的命令。所有输出行都是本机实跑后原样粘贴，
不是从 README.md / DESIGN.md 里抄的。上一位代理死在文档之前，它留下的"事实"里有两处与磁盘不符，
在 §4 改动表里逐条登记。

## 摘要

| 字段 | 值 |
| --- | --- |
| **App 名称** | 倒水量 |
| 仓库 | `/Users/zifang/workplace/ceo_workplace/z-biz-game/z-biz-game-pour-cos` |
| 形态 | 浏览器原生 ES modules（零依赖）+ 零依赖静态服务器 + Electron 壳 + GitHub Pages |
| 玩法一句话 | 几只没刻度的桶、一个龙头、一个下水道：用**最少几次**量出指定的数 |
| 动作词表 | 只有三个：`fill i` / `dump i` / `pour i→j`（倒到源空或目标满）。**没有半倒** |
| "最少几次"从哪来 | `js/core/solve.js` 的分层 BFS 在 `∏(cᵢ+1)` 上量出 `par`，**只在构建期**由 `tools/bake.mjs` 跑；`js/data/lots.js` 里印着 |
| 第二个可印数字 | `solutions` = 同层最短路线条数（BFS 走完目标层再求和），shipped 最大 3 090 |
| 第三个可印数字 | `states` / `depth` = `census()` 量的可达图，shipped 最大 4 710（`measure-12`） |
| 可解性判据 | `js/core/theorem.js`（Bézout：`gcd(caps) \| need`），与上面那个 BFS **不是同一段代码**；对账在 `test/bezout.test.mjs`（606/525/486/197 路，`mismatches []`） |
| 玩家点击时算什么 | 只有 `js/core/game.js:44 legal()` + `:50 act()`：**零搜索**，连 `limit=2` 早停都不需要（`@boot` 有一条"solver 从未被 fetch"的断言） |
| 已发布题量 | 63 道（`drip` 16 / `measure` 16 / `blend` 14 / `decant` 17），逐行由 `test/library.test.mjs` 从序列化 spec 重解复验 |
| 难度带 | `TIERS_META`（已发布，量出来的）：4-5 / 6-7 / 8-11 / 12-20；生成包络 `TIERS`（`js/core/make.js:167`）与它同行同址但**不是一个东西** |
| 依赖数 | 0（`dependencies` 与 `devDependencies` 都是 `{}`，无 `node_modules`、无 lockfile，由 `test/shape.test.mjs:62` 钉） |
| 二进制资产 | 0（桶、水面、龙头、下水道全部 `js/view.js` 的 canvas 2D 路径；`test/shape.test.mjs:81` 钉扩展名与 `data:` URI） |
| 测试钩子 | `window.pour`（`js/main.js:406`），`test/shape.test.mjs:105` 钉它是页面唯一的全局注入点 |
| 路由 | `#/c/N`、`#/lot/<id>`、`#/daily`、`#/random/<tier>/<token>`（`pour.md` 点名的两条是 `#/lot/<id>` 与 `#/daily`，本仓四条都有） |
| node 层 | 8 个套件 / **84 行断言 / 871 条 eq-ok** / `fail 0` / `rc=0` |
| browser 层 | **130 行 / 130 条**：`@boot 18 · @play 22 · @routes 26 · @save 24 · @pointer 40`，末行 `=== ALL GREEN ===` |
| 本次会话净新增 | `README.md`、`DESIGN.md`、本文件、`.github/workflows/ci.yml`、`.github/workflows/pages.yml`；改 `tools/playtest.mjs` 的 `@pointer`；重写 `js/data/lots.js`（bake 产物）；改 `js/core/theorem.js` 一处注释 |
| 未做的事 | 见 §5；两条 workflow **没有远端跑过**（本机无 git 仓库：`git status` → `fatal: not a git repository`），Electron 壳没有真实启动过 |

---

## 1. 文件清单与验证者

"由谁验证"只填一条具体的断言或一条能跑的命令。填不出验证者的行，不配存在。

| 文件 | 行 | 作用 | 由谁验证 |
| --- | --- | --- | --- |
| `index.html` | 68 | 壳：顶栏 / 画布 / 面板 / 通关卡 | `test/shape.test.mjs` "the page loads nothing from a network"（`<link rel="icon" href="data:,">`、`type="module"`、`<canvas>`、viewport、无 `https?:` 引用） |
| `css/game.css` | 119 | 全部样式 | 同上第二条（`url(` 不得出现 `https?:` 或 `data:`）；`@boot` 断言元素真的被排版 |
| `js/core/jug.js` | 203 | 模型：三动作、混合进制编码、后继枚举、`validate()`、`SPACE_LIMIT` | `test/jug.test.mjs` 14 行（含 "the action count grows with the buckets" 钉 2/3/4 桶 = 6/12/20 动作；"validate checks the start vector and the state-space ceiling" 打 `'state space 29760 over the 20000 ceiling'`） |
| `js/core/theorem.js` | 64 | Bézout 判据与面板解释文案的算术 | `test/bezout.test.mjs` —— **不 import 本文件**，自带手抄 `myGcd` 与独立可达集 BFS，三路对账 606/525/486/197 全 `mismatches []` |
| `js/core/solve.js` | 116 | 分层 BFS（`par` / `solutions` / `explored` / `truncated`）+ `census()` | `test/solve.test.mjs` 9 行：`brute` / `reachAll` 两个独立实现 + `test/fixture.mjs` 手抄 CLASSIC（par 6、16 状态闭式、逐层 `[1,2,3,2,2,2,2,2]`） |
| `js/core/game.js` | 106 | 一局：`legal` / `act` / `undo` / `reset` / `onRoute` / `hint` / `grade` | `test/game.test.mjs` 13 行；`@play`、`@pointer` 用真鼠标重复钉"零变化不计步" |
| `js/core/make.js` | 188 | 拒绝采样出题 + 难度带 + 平凡题筛子 | `test/make.test.mjs` 8 行（含 "fillShare 的上界是 0.5" 这条模型性质）；产物由 §2 的 `bake` 统计行打印 |
| `js/core/library.js` | 110 | 查表：战役 / 每日 / 随机 / id / `stats()` | `test/library.test.mjs` 7 行；`@routes` 26 行在真浏览器里跑同一批查表 |
| `js/core/storage.js` | 147 | 唯一 DOM 触点（`pour.save.v1`） | `test/storage.test.mjs` 16 行 / 392 行（四种坏环境）+ `@save` 24 行（真实落盘、两次点击清档） |
| `js/core/rng.js` | 51 | FNV-1a `hashSeed` + `mulberry32` + `todayKey` | `test/library.test.mjs` 用 `BigInt` 重推 FNV-1a 并断言 `randomLot` 的取模索引（`:173-193`） |
| `js/data/lots.js` | 71 | **构建期产物**：`TIERS_META` + 63 行题 | `test/library.test.mjs` "every printed line reproduces its own numbers when re-solved from the serialised spec"（逐行从序列化 spec 重解）+ `test/shape.test.mjs` "the baked pool carries the numbers its header claims" + `node tools/bake.mjs` 的 `throw` |
| `js/view.js` | 537 | canvas 2D 绘制 + 指针状态机（不判合法性） | `@pointer` 40 行全部经由它暴露的 `bucketPoint/faucetPoint/drainPoint/dragState`；`test/shape.test.mjs` "the shell owns the DOM and routes through one hook"（`getContext('2d')`、无 `drawImage`、无 `fetch`） |
| `js/main.js` | 461 | 路由、DOM、存档写入、`window.pour` | `@boot` 18 行（含"页面没有 fetch `solve.js`/`make.js`"）+ `@play`/`@routes`/`@save`；`test/shape.test.mjs` 钉 `window.pour` 是唯一全局 |
| `server.cjs` | 69 | 零依赖静态服务器（默认 5180） | `bash tools/verify.sh` 用它起 `WEB_PORT` （`:39` 起进程、`:52-66` 轮询 `/json/version` 与根目录都活才开始）；语法由 `npm run check` |
| `electron/main.cjs` | 34 | 桌面壳，复用同一台服务器 | **只有** `npm run check` 的 `node --check`；没有真实启动过 → §5 |
| `tools/bake.mjs` | 200 | 出题 → 去重 → 序列化重解 → 写产物 + 打表 | 本会话 `node tools/bake.mjs` 两跑（§2）；它自己的 `throw` 是"产物不许手改"的守门人 |
| `tools/harness.mjs` | 44 | 微型测试框架，node / 浏览器输出同形状 | 每个 `test/*.test.mjs` 末尾那行 `rows: N fail: M asserts: K`；`tools/verify.sh` 的花括号计数器读的是同一种形状 |
| `tools/playtest.mjs` | 875 | 零依赖 CDP 驱动（真鼠标键盘、截图、console） | `bash tools/verify.sh` 的 `browser totals: rows 130` 行；本次改动的目标文件 |
| `tools/verify.sh` | 164 | 一次性验收门 | 本会话原样跑过 4 次（§3 贴的是最后一次），`rc=0` |
| `test/balance.mjs` | 99 | 台架：量生成器，不写任何文件 | `node test/balance.mjs`（§2 两段输出都是它） |
| `test/fixture.mjs` | 107 | 手算 fixture（期望值不从被测代码读） | 被 `solve.test.mjs` / `game.test.mjs` import；`test/solve.test.mjs:103` 那条 par 6 |
| `test/*.test.mjs` | 8 个 | 见上面各行的验证者 | `npm run unit`（`package.json` 的 `unit` 脚本被 `test/shape.test.mjs:155` 逐字钉住）+ `node --test test/` + `tools/verify.sh` 的 node 段 |
| `package.json` | 40 | 脚本与零依赖声明 | `test/shape.test.mjs` "the package depends on nothing" / "npm run check sees every source file that ships" |
| `.github/workflows/ci.yml` | 52 | unit + browser 两个 job | **本机未执行过 Actions**。可核的是静态一致性：Syntax 步骤的 glob 列表与 `npm run check` 逐字相同（§3.4 那条 python 对账），Suites 步骤与 `pkg.scripts.unit` 同集合 |
| `.github/workflows/pages.yml` | 46 | Pages 部署 | 本机未执行过。可核的是：`cp` 只覆盖 `index.html css js`，而 `grep -oE '(src\|href)="[^"]+"' index.html` 得到的引用集合正是 `css/game.css` + `js/main.js` + `data:,`（§3.4） |

---

## 2. 数字从哪来

### 2.1 产物是哪一次 bake 写的

复现命令：**`node tools/bake.mjs`**（本机 7.5 秒）。本次会话连跑两次，两次产物**逐字节相同**：

```
$ node tools/bake.mjs            # 第一跑
warn: blend only reached 14 puzzles across pars 8,9,10,11
note: decant drew no puzzle for par 15,17,19; band ships 6 of 9 values
wrote 63 puzzles (drip:16 measure:16 blend:14 decant:17) -> js/data/lots.js in 7.5s
tier      n   par          per-par                              solutions           states   drawn  accept    rejections
drip      16  4-5 med=4.5  4x8 5x8                          sum=40 avg=2.5    448      405    4.94%     bandLow 119, bandHigh 108, gcdReject 63, needIsACapacity 62, pureTransfer 33
measure   16  6-7 med=6.5  6x8 7x8                          sum=211 avg=13.2  4710     842    2.38%     bandLow 494, needIsACapacity 115, gcdReject 115, bandHigh 98
blend     14  8-11 med=9.3 8x4 9x4 10x4 11x2                sum=1097 avg=78.4 726     23559   0.10%     bandLow 15664, gcdReject 3456, needIsACapacity 3376, bandHigh 1039, gaveUp 8
decant    17  12-20 med=15.6 12x3 13x2 14x3 16x3 18x3 20x3  sum=4632 avg=272.5 484   281217   0.01%     bandLow 209010, needIsACapacity 31846, gcdReject 31058, bandHigh 5805, spaceOverLimit 3474, gaveUp 109
node tools/bake.mjs  7.55s user 0.06s system 100% cpu 7.579 total
```

```
$ node tools/bake.mjs            # 第二跑（间隔数分钟、期间本机另有其它仓在跑 headless）
…同上，唯一差别是计时：7.8s / 7.77s user
$ md5 -q <第一跑产物> <第二跑产物>
b56070022ac55f9d66a1fde3adcb018e
b56070022ac55f9d66a1fde3adcb018e
```

`js/data/lots.js` 现在就是这份（`md5 -q js/data/lots.js` = `b56070022ac55f9d66a1fde3adcb018e`，71 行 / 63 道题）。
它**不是**本会话开始时磁盘上那份（`0839c82fb1db5d71511fb4e4822483f1`，72 行 / 64 道题）；
换掉的理由与全过程见 §4 改动表第 4 行。

`accept` 这一列低得反直觉，原因在 `bake.mjs` 的取题姿势：它**按 par 值轮询取名额**
（`perWanted`，`bake.mjs:66`）并用 `signature(spec)`（`:42`）去重，所以"同一个 par 的第二十种桶组"
越来越难找。它是计时与配额耦合的产物，**不是**"随便抽一题有多难抽中"——后者是下面这台架的量。

### 2.2 抽样本身有多难（`node test/balance.mjs`，本机 23.3 秒）

```
tier      band    drawn  accepted  rate     median  maxStates  gate  ms     cut  rejections
drip      4-5     160    160      100.00%  4.5     616        0     42     no   bandLow 988, bandHigh 744, gcdReject 588, needIsACapacity 372, pureTransfer 190
measure   6-7     160    160      100.00%  6.5     8736       0     183    no   bandLow 4013, needIsACapacity 1040, gcdReject 1003, bandHigh 743
blend     8-11    320    270      84.38%   9.2     1144       0     3031   no   bandLow 115576, needIsACapacity 25302, gcdReject 24943, bandHigh 7997, gaveUp 50
decant    12-20   640    336      52.50%   14.9    168        0     20001  yes  bandLow 595529, needIsACapacity 91510, gcdReject 89379, bandHigh 18521, spaceOverLimit 9871, gaveUp 304, truncated 21, timeout 1
totals: drawn 1280, accepted 926, 23.3s
```

同一台机器、同一个仓，本会话早先一次同命令的输出是
`decant 682 → 378、55.43%、中位 15.5、ms 20007`，前三档**逐位相同**。差别全在 `decant`：
那一档 `cut = yes`，被 20 秒的 `TIER_MS` 到点截断。这是"为什么计时量必须与结构量分开写"的现场证据。

### 2.3 按规格的"5000 题"口径放大样本

`pour.md §3` 说"四档带由 5000 题的实测 par 直方图定"。默认台架只量出 926 道，所以本仓换环境变量
再跑一次（不改代码；2 分 09 秒）：

```
$ CALLS=430 TIER_MS=180000 node test/balance.mjs
drip      4-5     860    860      100.00%  4.5     616        0     200    no   …
measure   6-7     860    860      100.00%  6.5     8736       0     949    no   …
blend     8-11    1720   1440     83.72%   9.2     1144       0     16895  no   …
decant    12-20   3870   2278     58.86%   15.8    168        0     111517 no   …
par histogram per band (draw order): 4:430 5:430 6:430 7:430 8:430 9:415 10:430 11:165 12:430 13:128 14:430 15:0 16:430 17:0 18:430 19:0 20:430
totals: drawn 7310, accepted 5438, 129.6s
```

两个结论：带的形状与 `median / maxStates` 不随样本量变（结构量）；
`decant` 的 `par 15 / 17 / 19` 各给 430 次机会仍然**一道都没有**（不是预算问题，是那个桶集合的
可达性结构），所以 shipped 的 `decant` 只覆盖 `{12,13,14,16,18,20}` 六个值。

### 2.4 已发布 63 道自己的形状（`node -e "import('./js/core/library.js').then(L=>console.log(L.stats()))"`）

```
{lots:63, byTier:{
   drip:{n:16,min:4,max:5,bucketsMin:2,bucketsMax:3,solMin:1,solMax:6,statesMin:18,statesMax:448,parMed:5,statesMed:182},
   measure:{n:16,min:6,max:7,bucketsMin:2,bucketsMax:4,solMin:1,solMax:48,statesMin:14,statesMax:4710,parMed:7,statesMed:321},
   blend:{n:14,min:8,max:11,bucketsMin:2,bucketsMax:3,solMin:1,solMax:804,statesMin:18,statesMax:726,parMed:9,statesMed:37},
   decant:{n:17,min:12,max:20,bucketsMin:2,bucketsMax:3,solMin:1,solMax:3090,statesMin:30,statesMax:484,parMed:16,statesMed:42}}}
```

逐位可核的极值：最大可达图 `measure-12`（桶 `[4,8,11,12]`，编码空间 `5·9·12·13 = 7020`，可达 4 710）；
最多最短走法 `decant-04`（桶 `[5,9,14]` 量 7，`solutions = 3090`）；最大容量 14。
`multiTargetRows = 0`、`nonEmptyStart = 0` —— 63 道里没有一行用到多目标或带水开局（→ §5 第 3 条）。

### 2.5 结构量 / 计时量

| 结构量（换机器逐位相同，且几乎都写死在断言里） | 计时量（本机本次实测，随负载漂移） |
| --- | --- |
| `par / solutions / states / depth / route`（每行被 `test/library.test.mjs` 重解比对）、`∏(cᵢ+1)`、动作数 6/12/20、`SPACE_LIMIT 20000 / MAX_BUCKETS 4 / MAX_CAP 60`、Bézout 的 606 / 525 / 486 / 197 / 161 与 `mismatches []`、CLASSIC 的 16 状态与逐层 `[1,2,3,2,2,2,2,2]` 与闭式 `8+12−4`、四档 par 边界 4-5 / 6-7 / 8-11 / 12-20、shipped `n = 16/16/14/17`、`decant` 缺 `15/17/19`、node 层 84 行 / 871 条、browser 层 130 行、`lots.js` 的 md5 | `bake` 总耗时（7.5 s / 7.8 s）、`balance` 的 `ms` 列与 `decant` 的 `drawn/accepted/median`、`node --test` 的 `duration_ms`、headless 每段墙钟、`TIER_MS` 在哪一档截断 |

---

## 3. 验收结论（原样粘贴）

### 3.1 `npm run check`

```
$ npm run check
> pour@1.0.0 check
> for f in js/*.js js/*/*.js server.cjs electron/main.cjs tools/*.mjs test/*.mjs; do node --check "$f" || exit 1; done && echo OK

OK
rc=0
```

### 3.2 `node --test test/`

```
$ node --test test/
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 94.946666
rc=0
```

`ℹ tests 8` 是**文件数**（node:test 把每个文件算一个 test）。每个套件自己那行汇总：

```
test/bezout.test.mjs    rows: 8  fail: 0 asserts: 251
test/game.test.mjs      rows: 13 fail: 0 asserts: 106
test/jug.test.mjs       rows: 14 fail: 0 asserts: 93
test/library.test.mjs   rows: 7  fail: 0 asserts: 79
test/make.test.mjs      rows: 8  fail: 0 asserts: 79
test/shape.test.mjs     rows: 9  fail: 0 asserts: 49
test/solve.test.mjs     rows: 9  fail: 0 asserts: 122
test/storage.test.mjs   rows: 16 fail: 0 asserts: 92
                        ── 合计 84 行 / 871 条
```

规格 `pour.md §5` 要 `node ≥ 38`：按"行"是 84，按"条"是 871，两种口径都过。

### 3.3 浏览器层（`SKIP_UNIT=1`，与 CI 的 browser job 同一姿势）

```
$ SKIP_UNIT=1 CDP_PORT=9346 WEB_PORT=5196 SHOT_DIR=/tmp/puzzle-brief/shots bash tools/verify.sh   # /tmp/pour-verify-final.txt
=== node suites (rules, search, number theory, pool, save, shape) ===
cross-check ids: daily=decant-06 random(blend|fixed)=blend-04
opened http://127.0.0.1:5196/
(no console output)
boot lot: drip-01
=== @boot ===
rows: 18 passed: 18 fail: []
=== @play ===
rows: 22 passed: 22 fail: []
=== @routes ===
rows: 26 passed: 26 fail: []
=== @save ===
rows: 24 passed: 24 fail: []
=== @pointer ===
rows: 40 passed: 40 fail: []
browser totals: rows 130 asserts 130
=== completion shot ===
"{\"id\":\"drip-01\",\"moves\":4,\"par\":4,\"done\":true}"
=== ALL GREEN ===
rc=0
```

（第一段标题在 `SKIP_UNIT=1` 下只是回声一行，node 套件被跳过 —— 那 84 行由 §3.2 单独跑过。
`cross-check ids` 是本仓的一条 node↔browser 对账：同一个 `#/daily`、同一个
`#/random/blend/fixed` 在 node 侧查表与浏览器侧查表必须给同一个 id。）

规格 `pour.md §5` 要 `browser ≥ 38`：按行 130。要的五段 `@boot @play @routes @save @pointer` 齐备，
每段 `fail: []`，末行 `=== ALL GREEN ===`。`@pointer` 是真实 `Input.dispatchMouseEvent`，
把 `drip-01`（par 4，`≤ 6` 满足规格那句）整条认证解拖到通关。

截图两张（`ls -l` 原样）：

```
-rw-r--r--@ 1 zifang wheel 163904 Sep 27 17:55 /tmp/puzzle-brief/shots/pour-boot.png
-rw-r--r--@ 1 zifang wheel 145402 Sep 27 17:56 /tmp/puzzle-brief/shots/pour-win.png
```

`pour-win.png` 是完成态：`window.pour.play(window.pour.route())` 之后拍的通关卡片。

进程残留核对（`pour.md` 与任务单都要求过）：

```
$ pgrep -fl remote-debugging-port | grep pour-cos   # 无输出
$ pgrep -f "node server.cjs" | …按 cwd 归属…       # 剩下的是 ferry / ashen-ring / nonogram，不是本仓
$ lsof -nP -iTCP -sTCP:LISTEN | grep -E ':(9346|5196) '
（无输出 —— 两个端口已释放）
```

### 3.4 文档与工作流的两条静态对账

```
$ python3 -c "…比对 pkg.scripts.check 与 ci.yml 的 Syntax 步骤里的 glob 列表…"
npm run check globs: ['js/*.js', 'js/*/*.js', 'server.cjs', 'electron/main.cjs', 'tools/*.mjs', 'test/*.mjs']
ci.yml Syntax globs: ['js/*.js', 'js/*/*.js', 'server.cjs', 'electron/main.cjs', 'tools/*.mjs', 'test/*.mjs']
identical: True
$ grep -oE '(src|href)="[^"]+"' index.html | sort -u
href="css/game.css"
href="data:,"
src="js/main.js"
```

`pages.yml` 的 `cp` 行只有 `cp index.html _site/` 与 `cp -r css js _site/`，
与上面这个引用集合一一对应；`server.cjs`、`electron/`、`tools/`、`test/`、`package.json` 都不进产物。
**没有** `path: .`。

---

## 4. 改动表（先写错在哪 → 为什么对）

本仓不是 git 仓库（`git status` → `fatal: not a git repository`），所以"改动"只能靠本会话自己的
前后对照与留档文件证明；留档在 `/tmp/pour-verify-run1.txt`（红的第一次）、`/tmp/pour-verify-run2.txt`（`@pointer` 修好后第一次绿，旧产物）、
`/tmp/pour-verify-run3.txt`、`/tmp/pour-verify-run4.txt`、`/tmp/pour-verify-final.txt`（§3.3 贴的就是最后这次，跑在**当前磁盘状态**上：
`theorem.js` 注释改过、`lots.js` 是新产物、三份文档与两条 workflow 都已落盘）、
`/tmp/pour-bake-run.txt`、`/tmp/pour-bake-run2.txt`、`/tmp/pour-balance-run.txt`、`/tmp/pour-balance-5k.txt`。

| # | 曾经的错误 | 错在哪 | 为什么现在是对的 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | `@pointer` 的过拖段落只发一个 `mouseMoved`，从起手桶直落到所有区域之外 | 视图的 target 是**粘滞**的，只登记真的进过的区域；一步跳出局外的坐标从来没"瞄过"目标桶，`dragState()` 报 `target = 起手桶, action = null, progress = 0`。于是那两条断言在评一次**没有意图**的拖动 | 现在走两步：先 `mouseMoved` 进目标桶（读 `aimed`，断言 `op === 'pour'`、`i === 0`、`j === last`、`legal === true`），再走到区域外的 `way`。`way` 是用 `dst + v` 投影**自己算出来的**，`want` 由像素反推，所以 `|over.over − want| < 0.06` 量的是实现而不是实现的自述 | run1 第 18-19 行两条 FAIL 的 detail（`"action":null,"over":0` 而 `want 1.838`）；run4 `@pointer rows: 40 fail: []` |
| 2 | 同一段落断言"过拖之后 `moves === 1`"，同时要求那次拖动真的倒了水 | fill 一步 + pour 一步 = 2。这是**断言自己**自相矛盾，无论实现多正确都不可能绿 | 计步基准显式取为 `afterFill + 1`（真鼠标 fill 之后再真鼠标 pour），并且加了一条容量不变式 `no bucket is ever asked to hold more than its capacity` | run1 第 20 行 detail `{"want":3,"moves":1,"pos":[3,0,0],"caps":[3,4,9]}`（水量根本没动）；run4 的 `and the water still stops at the rim…` 绿 |
| 3 | "把桶抬到龙头中途"的段落只采 4 个插值点 | 桶身最高 414 px、龙头带只有 `TAP = 78` px 高，4 个点没有一个落进龙头带 ⇒ 视图报告的 `target.z` 始终是 `bucket`，`progress` 恒为 0，那两条"预览是分数"的断言在评一个从未开始的拖动 | 走 40 步真实 `mouseMoved`，断言取的是**视图自己报告的第一步入区**那一次：`lift.target.z === 'tap'` 且 `action.op === 'fill'`；再分别钉"进了区还没碰到龙头 ⇒ `0 < progress < 1`"与"手指真的抵达龙头 ⇒ `progress > 0.9`" | run1 第 15-17 行三条 FAIL；run4 的 `a bucket raised into the faucet zone…` / `the preview is a fraction…` / `and it is fully poured only once…` 三条绿 |
| 4 | 磁盘上的 `js/data/lots.js` 与当前 `tools/bake.mjs` 的输出不一致 | 任务单给的磁盘事实是"js/data/ 有产物"（md5 `0839c82f…`，72 行 / 64 道 / `decant` 18 道 / `TIERS_META 12-18`）。但 `node tools/bake.mjs` 重跑两次得到 `b5607002…`（63 道 / `decant` 17 / `12-20`，且 `par 20` 有题、`15/17/19` 没有）。旧产物**不是坏数据**（它的每一行仍被 `library.test.mjs` 逐位复验），只是**当前生成器复现不出来** | 采取生成器可复现的那一份：两次连跑逐字节相同的 `b5607002…` 留下，并且**重跑全部三层验收**（node `rc=0`、`npm run check rc=0`、浏览器 `ALL GREEN`）都针对它。附带好处：`TIERS_META` 的 `decant 12-20` 与生成包络 `make.js` 一致，旧产物那条 12-18 是上一位代理留在这个文件上的唯一一处"两个带说法不一致" | `/tmp/pour-lots-original.js`（旧，md5 `0839…`）与 `/tmp/pour-lots-bake1.js`、`/tmp/pour-lots-bake2.js`（新，两份同 md5 `b560…`）；§2.1 的两跑输出 |
| 5 | `@pointer` 里有几处用页面内 JS 改状态来"布置现场"（例如 `window.pour.play([{op:'fill',i:0}])` 制造一只满桶） | 那类段落证明的是 `commit()` 对，不是手指点得着；规格 `pour.md §4/§5` 与契约 §3 都要求真实输入 | 改成真实拖动布置（`dragTo(bucket, tap)` 灌满），JS 只负责读回结果。并新增三条非法倒水**不计数**的断言（倒进已满的桶、空桶对着龙头、抽干一只空桶）+ 拖回原桶=取消（`pour.md §4` 那条"松手前可以拖回原桶取消"在此之前**没有任何断言**）+ 一步容量不变式 | 任务单允许的那条"这不算放宽，是加严"；`@pointer` 从 31 行（run1）到 40 行（run4），core 与测试的期望值一行没动 |
| 6 | `js/core/theorem.js:36-37` 的注释承诺了一个不存在的字段：`so 'tentative' is set to say the verdict has not been proven sufficient` | `canMeasureAny()` 返回裸布尔，全仓 `grep -rn tentative` 只有这一处命中。契约 §5 "不做只有文件没有接线的幽灵功能"同样适用于注释里的幽灵字段 | 注释改成描述**实际行为**："两桶时这是定理所以精确；三桶以上 `true` 只意味着'算术上不禁止'，判定权在 `js/core/solve.js`"。**没有**改任何函数体、任何期望值 | 改前 `grep -rn tentative js` = 1 hit；改后 0 hit；`npm run check`、`node --test test/`、`tools/verify.sh` `npm run check` rc=0、`node --test test/` 8/8 pass、`tools/verify.sh` `=== ALL GREEN ===`（`/tmp/pour-verify-final.txt`）都是改完之后重跑的 |
| 7 | 上一位代理（或派单）声称 "node asserts 84" | 84 是**行数**（各套件 `rows:` 相加：8+13+14+7+8+9+9+16），`asserts` 实测是 **871**；而 `node --test test/` 汇总里的 `ℹ tests 8` 是**文件数**。三个口径都被混叫成"断言数" | 本报告与 README/DESIGN 一律写成"84 行 / 871 条"，并把 `node --test` 的原始汇总一起贴出来（§3.2）。注意 `asserts` 这一列**不是**完全固定的：`test/solve.test.mjs:172` 那条双搜索器对账按"产物里出现的每个 par 值"各出 2 条，所以换一池产物就会抖几个。行数（84）才是稳定的口径 | §3.2 的每套件 `rows / asserts` 表；旧产物下同一命令本会话也实跑过一遍：84 行 / **869** 条，差异全在 `test/solve.test.mjs`（120 → 122），因为新池多了 `par 20` 这个值（旧池最高 18） |
| 8 | 显示名有三个来源打架：任务单写 `倒水`，`pour.md §3 行 3` 写 `中文名/显示名：倒水量`，磁盘上的 `index.html:9` 是 `<title>倒水量 · POUR</title>`（`package.json` 的 `description`、`tools/verify.sh:2` 也都是"倒水量"） | `BUILDER.md:48` 与 `DELIVERABLE-TEMPLATE.md:11-13` 要的 `中文名` 是**规格里那个**，而且要求 README 首行与交付报告的 App 名称行逐字相同。若照任务单的 `倒水` 写，README 首行会与 shipped 页面标题不一致 | 按任务单自己的那句"若规格里另有中文名以规格为准"取 **倒水量**：`README.md` 首行 `# 倒水量 · POUR`、本文件首行 `# 倒水量 - 交付报告`、App 名称行 `| **App 名称** | 倒水量 |`，与 `index.html` 的 `<title>` 逐字一致。**这件事需要 lead 确认**（若组织全景里要的是"倒水"，那么需要同步改的是 `index.html` 与规格，不只是文档） | `head -1 README.md`、本行、`grep -n '<title>' index.html` 三处比对 |
| 9 | 规格 `pour.md §3` 要求"用解里 fill 占比 > 80% 这类实测特征筛掉一眼可见的题" | 这条筛子在本模型里**永远不会开火**：水从龙头打进来必须至少被倒走一次才会出现答案 ⇒ 任何认证解 `fills ≤ par/2`，`fillShare ≤ 0.5`（`test/make.test.mjs:69` 把 0.5 当成模型性质在断言，`:70` 还要求"0.5 被反复达到"，所以不是样本假象） | `routeFeatures()` 仍然打印 `fillShare`（它是被量的数，不是被执行的规则），80% 那条规则真正想拦的那一族由 `pureTransfer`（条件在 `make.js:68`，阈值 `TRANSFER_PAR_MAX = 4` 在 `:30`）拦，本次 `drip` 档实测开火 190 次（§2.2）。**与规格不同之处如实登记，没有照做不说** | `test/make.test.mjs` "the largest fill share in the whole family is 0.500, not over a half"；`make.js:24-29` 的注释；§2.2 的 `pureTransfer 190` |
| 10 | 派单口径"点击时只允许 `limit=2` 早停，全 BFS 只在 bake" | 那是**下界**，不是本仓的姿势。本仓点击时零搜索：提示只走烘焙路线，离开路线就返回 `{off:true}`（`game.js:90`），所以没有任何东西需要"数到 2 就停" | `js/main.js:4-8` 的头注释声明本文件不 import 搜索器，运行期由 `@boot` 的两条配套断言证明：`solve.js` 与 `make.js` **从未出现在 `performance.getEntriesByType('resource')` 里**（`tools/playtest.mjs:563`），同时 `js/data/lots.js` **确实**被 fetch 了（`:566`）—— 后一条防的是"什么都没加载所以当然没搜索"这种假绿 | §3.3 的 `@boot rows: 18 fail: []`；静态那侧只有间接防线：`test/shape.test.mjs:111` 禁掉 `view.js` + `main.js` 里的 `fetch(` / `XMLHttpRequest` / `import(` |
| 11 | `tools/verify.sh` 的第一次实跑看起来"全绿但只有 0 行"，因为 9341/5190 上挂着一台 Chrome 与一个 `server.cjs`，`cwd` 是本仓，进程却是上一位代理留下的 orphan | 这正是任务单预警的那类陷阱：脚本连上了**别人的** Chrome 与**别人的**（陈旧代码的）服务器，验收结果与磁盘无关 | 只杀 `cwd` 属于本仓的那两个 PID（先 `lsof -a -p PID -d cwd` 确认，其它仓的 Chrome 一个不碰），换 `CDP_PORT=9346 / WEB_PORT=5196` 重跑，跑完复查端口与进程都空 | 本报告 §3.3 末尾的残留核对；`/tmp/pour-verify-run2.txt` 起就是干净端口上的实跑 |
| 12 | 台架的 `getImageData` 像素探针让 console 每条都带一句 `willReadFrequently` 警告 | 上下文由 `js/view.js:50` 的 `getContext('2d')` 创建，属性不能在事后补；警告是**台架**制造的，不是 shipped 路径的缺陷 | 不改 shipped 渲染（那条属性会把水面渐变与每帧重绘推到 CPU 后端）。收集条件 `level === 'error' \|\| source === 'rendering'`（`playtest.mjs:92`）只把它**打印给人看**，不参与任何断言；九连环那仓的做法（view 里带属性）没有照抄，理由写在 DESIGN.md §7.4 | §3.3 的 `--- console ---` 原文；`node --test test/` 与 `verify.sh` 都不因它变红 |

**没有做的事**：没有放宽任何断言、没有删过测试、没有把期望改成"实现的实际输出"、
没有执行任何 git 写操作（本仓连 `.git` 都没有）、没有写过本仓以外的任何目录
（`/tmp/puzzle-brief/shots/` 下的截图是任务单指定的产物目录，`/tmp/pour-*.txt` 是本会话的留档）。

---

## 5. 未实现 / 未验证清单

1. **两条 workflow 没有远端跑过**。本机没有 git 仓库（`git status` → `fatal: not a git repository`），
   任务单也禁止 git 写操作，所以 `ci.yml` / `pages.yml` 只有静态对账（§3.4）。
   `ci.yml` 的 browser job 依赖 GitHub runner 上的 `google-chrome`：`tools/verify.sh:23-30` 会去找
   `google-chrome` / `chromium`，但**本机上没有 Linux runner 可验证**。
2. **Electron 壳只过 `node --check`**，仓库不装 electron（零依赖纪律），没有真实启动过。
3. **多目标与带水开局没有被出题**：`jug.validate` 会校验 `start` 向量与数组 `target`，
   `jug.isGoal` 与 `solve` 都按多目标算 par（`test/solve.test.mjs:204` 有手算断言），
   但 `make.draw()` 永远抽 `start = 全空` 且单个 `target` ⇒ shipped 63 行里 `multiTargetRows = 0`、
   `nonEmptyStart = 0`。要开这一族，`trivialReason()` 的"两步之内"筛子得重想。
4. **没有"离开认证路线之后的第二意见"**：`hint()` 返回 `{off:true}` 就结束。这是 DESIGN.md §5 的
   刻意取舍（点击时不搜索），但对玩家而言"提示没了"是功能缺失，得靠撤销回到路线上。
5. **移动端没有真机验证**：`index.html` 有 viewport、`css/game.css` 有 ≤820px 断点、
   `js/view.js` 走 pointer events + `touch-action: none`，但验收是 1280×820 桌面 headless。
6. **`decant` 档带内 par 不等距**（缺 `15/17/19`，见 §2.3）。不是 bug，但意味着"每一档都是曲线"
   这句话在最高档只成立到 6/9 个点。规格 `pour.md §3` 只要求四档互不重叠，这条成立。
7. **没有音效 / 彩带 / 成就 / 排行榜 / 云存档 / 分享战绩**：契约 §5 的 E 组禁令，本仓一条没做。
   分享只有 `#/lot/<id>` 与 `#/random/<tier>/<token>`，分享的是谜题本身。
8. **上一位代理的其余自述只复核到能指到断言的那一条**：任务单带来的磁盘事实
   `files/loc 32/5499` 按同一姿势重量：`find . -type f | wc -l` = **37**（32 + 两份 workflow + 三份文档），
   只算代码（`*.js *.mjs *.cjs *.css *.html *.sh`）= **5 780 行**。多出的 281 行里 258 行是
   `tools/playtest.mjs` 的 `@pointer` 重写（改动表 1/2/3/5 行）、4 行是 `theorem.js` 的注释
   （改动表 6 行），余下是任务单口径与本仓 `wc -l` 口径的差集（`LICENSE`、`.gitignore` 之类）。
   `zero-deps ok / binary assets 0 / core purity clean` 三条分别由 `test/shape.test.mjs:62`、`:81`、`:41`
   在跑绿的 84 行里复验；`window.pour =` 由 `:105` 与整个浏览器层复验。
   **`unwired exports none` 这一条本会话另外自己量了一遍**（仓里没有对应的测试）：把
   `js/**/*.js`、`tools/*.mjs`、`test/*.mjs`、`server.cjs`、`electron/main.cjs` 全部读进来，
   对每个 `export const|function NAME` 找除声明处以外的引用 —— **0 个未接线导出**。
   方法只是按名字的文本可达性，不是真正的调用图（同名会互相打掩护），但足以支持"没有幽灵功能"这句。
