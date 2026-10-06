# 倒水量 · POUR

几只没有刻度的桶、一个水龙头、一个下水道：量出指定的那个数。经典"倒水问题"（Die Hard 3 那类）的
浏览器实现，它和纸面版本的关键区别有两条，而且这两条互相独立：

**"最少几次"是广度优先搜索在 `∏(cᵢ+1)` 状态图上量出来的精确最短路径；
"这个数到底量不量得出"是数论定理（Bézout）判出来的。两个机制互不打分——
难度数字不由算出它的那套代码来判定题，可解性也不由一次没跑完的搜索来否决。**

- **谁算了屏幕上的每个数字**：`js/core/jug.js` 只有模型（三种动作、编码、后继枚举、合法性），
  `js/core/solve.js` 的分层 BFS 产出 `par`（最少次数）、`solutions`（**同层最短路线条数**）、
  `explored`；`js/core/solve.js` 的 `census()` 另出一张可达图，产出 `states`（可达位置数）与 `depth`。
  面板上"最少 N 次 / 最优走法 M 条 / 可游荡 K 个状态"读的就是这三个数，它们全部在构建期由
  `tools/bake.mjs` 量好、写进 `js/data/lots.js`，`test/library.test.mjs` 每次 CI 逐行从序列化后的
  桶配置**重解一遍**再比对。第三个机制 `js/core/theorem.js` 只回答"可解吗"：
  `gcd(caps) | need` 且 `need ≤ 目标桶容量`。它给出的必要条件是免费的，所以生成器先用它筛、
  再让 BFS 决定，两把尺子的对账是 `test/bezout.test.mjs`（见下）。
- 零依赖、零美术、零打包器：只有 `index.html` + `css/` + `js/`，桶、水面、龙头、下水道全部由
  `js/view.js` 用 canvas 2D 路径画出来，仓里 0 个二进制**文件**（PWA 安装要的那张 512 图标不例外：
  它是 base64 内联在 `manifest.webmanifest` 里的，宽高由上线清单闸的 P 段解码后核对真图）。
- 63 关已烘焙并逐行复验，四档带的区间是从实测 `par` 直方图里定的：默认台架 1 360 次抽样 / 1 006 道题
  （本次复现值；`decant` 被 `TIER_MS` 截断的那一跑是 1 280 次抽样 / 926 道题，两个都是**抽样数**口径），
  按规格 `pour.md §3` 的"5000 题"口径放大到 7 310 次抽样 / 5 438 道题再量一遍，三档低难度的
  `median / maxStates` 一个字没变（`node test/balance.mjs`，两次输出都在 DESIGN.md §4.2）。
- 战役 / 每日 / 随机 / 分享链接四种入口，同一个 id 或同一个 token 在任何设备上都是同一道题。
- 本地存档（localStorage），无账号、无网络请求、可离线。

## 跑起来

```bash
node server.cjs            # http://127.0.0.1:5180/（ES module 需要一个 origin，file:// 会被 CORS 挡掉）
npm run unit               # 八个 node 套件：84 行断言、874 条 eq/ok
bash tools/verify.sh       # node 套件 + headless Chrome 真实鼠标拖动验收（131 行断言）
node test/balance.mjs      # 生成器实测：接受率、逐档拒绝原因、最大状态数（本机实测 20.5 秒；已接进 ci.yml 的 unit job 与 tools/verify.sh，本地与 CI 同一条命令）
node tools/bake.mjs        # 重新出题 + 复验，重写 js/data/lots.js（本机 7.5–7.8 秒）
npx electron .             # 桌面壳（需自行 npm i -D electron，本仓不装）
```

## 玩

- 画面上是几只空桶，顶部一个水龙头、右下下水道。**只有三个动作**：
  桶拖到龙头 = `fill`、拖到下水道 = `dump`、桶拖到桶 = `pour`（倒到源桶空或目标桶满为止）。
  从龙头往桶上拖是同一个 `fill` 的反向写法。**没有半倒**：没刻度的桶认不出"一半"是什么状态，
  一旦允许，状态图就不再是有限个位置，本仓每个数字都会失去意义。
- 目标：让面板指定的那只桶恰好装着 `need`。模型也支持"任一只"的多目标口径
  （`target` 可以是数组，`isGoal` 与 BFS 都按多目标算 par），但 63 道里没有一道用到。
- **零变化的动作不计步**：满桶再 fill、空桶再 dump、往已满的桶里倒，都不算一步，也不改一滴水
  （`js/core/game.js` 的 `legal()` 与搜索入队规则是同一个判断，玩家计数器和 BFS 不会各说一套）。
- 拖过头（指针越过桶沿）意图保留、水量钳在沿口；拖回起手那只桶 = 取消。
- 面板实时印 `次数 / 最少 / 最优走法 / 可游荡状态 / 容量表 / #/lot/<id>`。提示 `h` 只走烘焙好的那条
  认证路线，一旦玩家离开路线它就诚实地说"不在认证路线上"，**不会**现场重搜；撤销 `u`、重开 `r`。
- 打平"最少" = ★★★「分毫不差」，多花 1–3 次 = ★★「尚有余量」，再多 = ★「总算量出」
  （`js/core/game.js:101`）。用过提示就失去完美档。

## 这几张表是谁算的

```bash
node tools/bake.mjs        # 出题 + 复验 + 打印实测；本机跑 7.5 秒，两次连跑产物逐字节相同
```

```
wrote 63 puzzles (drip:16 measure:16 blend:14 decant:17) -> js/data/lots.js in 7.5s
tier      n   par          per-par                              solutions           states   drawn  accept    rejections
drip      16  4-5 med=4.5  4x8 5x8                          sum=40 avg=2.5    448      405    4.94%     bandLow 119, bandHigh 108, gcdReject 63, needIsACapacity 62, pureTransfer 33
measure   16  6-7 med=6.5  6x8 7x8                          sum=211 avg=13.2  4710     842    2.38%     bandLow 494, needIsACapacity 115, gcdReject 115, bandHigh 98
blend     14  8-11 med=9.3 8x4 9x4 10x4 11x2                sum=1097 avg=78.4 726     23559   0.10%     bandLow 15664, gcdReject 3456, needIsACapacity 3376, bandHigh 1039, gaveUp 8
decant    17  12-20 med=15.6 12x3 13x2 14x3 16x3 18x3 20x3  sum=4632 avg=272.5 484   281217   0.01%     bandLow 209010, needIsACapacity 31846, gcdReject 31058, bandHigh 5805, spaceOverLimit 3474, gaveUp 109
```

`accept` 这一列是**按 par 名额凑题**的接受率（`bake.mjs` 给每个 par 值轮询取样，再用
`signature()` 把"同一组容量 + 同一目标 + 同一个 need"的重复题丢掉），所以名额越大越难凑
——`blend` 那档凑到 14 道就停了（`warn: blend only reached 14 puzzles across pars 8,9,10,11`）。`node test/balance.mjs` 量的是另一件
事——"随便抽一道题要抽多少次才中"，下面是本机原样输出（实测 20.5 秒，脚本自报 20.3s）：

```
tier      band    drawn  accepted  rate     median  maxStates  gate  ms     cut  rejections
drip      4-5     160    160      100.00%  4.5     616        0     41     no   bandLow 988, bandHigh 744, gcdReject 588, needIsACapacity 372, pureTransfer 190
measure   6-7     160    160      100.00%  6.5     8736       0     167    no   bandLow 4013, needIsACapacity 1040, gcdReject 1003, bandHigh 743
blend     8-11    320    270      84.38%   9.2     1144       0     2868   no   bandLow 115576, needIsACapacity 25302, gcdReject 24943, bandHigh 7997, gaveUp 50
decant    12-20   720    416      57.78%   15.9    168        0     17224  no   bandLow 609265, needIsACapacity 93580, gcdReject 91363, bandHigh 18579, spaceOverLimit 10090, gaveUp 304

par histogram per band (draw order): 4:80 5:80 6:80 7:80 8:80 9:79 10:80 11:31 12:80 13:16 14:80 15:0 16:80 17:0 18:80 19:0 20:80
totals: drawn 1360, accepted 1006, 20.3s
gate: a candidate enters only if ∏(capacity+1) <= 20000 (js/core/jug.js SPACE_LIMIT).
```

`decant` 这一跑是 `cut = no`：九个 par 值在 17 224 ms 内抽完，没有撞到 20 秒预算
（`TIER_MS=20000`），所以 `drawn 720 / accepted 416 / median 15.9`。这里替换掉的是负载更高的
一跑：那一跑在 par 20 之前被截断（`cut = yes`，`drawn 640 / accepted 336 / median 14.9`），
totals 于是写成 1 280 / 926。**两个数都是抽样次数（drawn），不是题数**；被接受的题数是
1 006 与 926，而它们又都不等于出厂的 63 关——`drawn` 是样本分母，`accepted` 是结果分母，
63 是烘焙进 `js/data/lots.js` 的出厂分母，三个数不能互换。前三档的结构列
（drawn / accepted / rate / median / maxStates）两跑逐位相同，只有 `ms` 在漂。
结构量与计时量的分别见 DESIGN.md §4。

已发布的 63 关本身（`js/data/lots.js`，md5 `b56070022ac55f9d66a1fde3adcb018e`）：
`par` 区间 4–20，可达状态最大 4 710（`measure-12`，桶 `[4,8,11,12]`），最短路线条数最大 3 090
（`decant-04`，桶 `[5,9,14]` 量 7），最大容量 14。任何一行手改一个数字，`test/library.test.mjs` 就红。

定理那一头的对账由 `test/bezout.test.mjs` 现场跑（`node test/bezout.test.mjs`）：
`a,b ∈ 1..9`、`t ∈ 0..max(a,b)` 共 **606 问**，其中非零 **525 问**对应"任一只桶"这个目标定义，
命名目标桶那一路是 **486 问**，三桶 6×6 抽样另有 **197 问（非零 161）**；
三路全部 **0 处不一致**，参与对账的 `gcd` 是测试里手抄的减法版本、可达集是独立写的字符串键 BFS，
**都不 import `js/core/theorem.js`**。规格 `pour.md §0` 里的 525/486 因此在仓里是一条会红的断言，
而不是一句话。

## 验收

`bash tools/verify.sh` 一条命令跑完两层：

- **node 层 84 行 / 874 条**：`bezout`(8) 定理与搜索三路对账、`jug`(14) 模型与校验器负例、
  `solve`(9) 3-5-4 手算 par=6 + 深度 5 穷举反证 + 多目标 par + 零变化不入队 + 预算与截止、
  `make`(8) 难度带形状与确定性、`library`(7) 逐行复解、`game`(13) 计数与评星、
  `storage`(16) 三态退化与单调性、`shape`(9) 零依赖/零二进制文件/core 无 DOM。
- **浏览器层 131 行**：`tools/playtest.mjs` 起真实 headless Chrome，`@boot`(18) 画布真的排版并
  画出像素、`@play`(22) 通关/评星/提示/计数、`@routes`(26) 四种路由与钳制、`@save`(25)
  localStorage 落盘、两次点击清档、盘上那一份自记的格式版本、`@pointer`(40) **派发真实 `Input.dispatchMouseEvent`**
  把 `drip-01`（par 4）整条认证解拖到通关，并断言：原地按下去不动、往已满的桶里倒不计步、
  倒一只空桶不计步、抽干一只空桶不计步、拖回起手那只桶=取消、越过桶沿的过拉被钳在沿口，
  以及一条容量不变式。

## 文件地图

```
index.html            壳：顶栏 / 画布 / 右侧面板 / 通关卡（含 data: 的 favicon，防 404 污染 console）
manifest.webmanifest  PWA 清单：start_url/scope 都相对，四张图标 base64 内联（仓里因此没有 .png 文件）
sw.js                 离线壳：一律网络优先，命中才回填缓存；PRECACHE 只收上面两件
css/game.css          全部样式，一个文件
js/core/jug.js        模型：三种动作、混合进制编码、后继枚举、规格校验、状态空间门槛（无 DOM）
js/core/theorem.js    数论判据：gcd / gcdAll / canMeasureAny / canMeasureAt / reachableAmounts
js/core/solve.js      分层 BFS：par / solutions / explored / truncated + census() 可达图
js/core/game.js       一局：legal/act/undo/hint/onRoute/grade，运行期唯一的合法性来源（不搜索）
js/core/make.js       难度带 + 拒绝采样出题（只在构建期被 import）
js/core/library.js    查表：战役 / 每日 / 随机 / id + stats()
js/core/storage.js    localStorage 存档，无 window 或存储被拒时退化成内存
js/core/rng.js        FNV-1a 种子哈希 + mulberry32
js/data/lots.js       构建期产物：TIERS_META + 63 行带实测 par / solutions / states / route 的题
js/view.js            canvas 2D 绘制与指针手势，不判合法性（只问 game.legal）
js/main.js            路由、DOM、存档写入、window.pour 测试钩子
server.cjs            零依赖静态服务器          electron/main.cjs  桌面壳
tools/bake.mjs        出题 → 复验 → 写 lots.js，并打印实测表
tools/assemble-site.sh 上线文件的唯一清单：pages.yml 与本地闸都调它拷产物
tools/deploy-set.mjs  对拷出来的产物提要求     tools/deploy-set-selftest.mjs  逐刀证明它会红
tools/playtest.mjs    零依赖 CDP 驱动，真实鼠标键盘事件      tools/verify.sh  一次性验收门
tools/harness.mjs     微型测试框架，node 与浏览器套件输出形状一致
test/                 八个套件 + 手算 fixture.mjs + 难度台架 balance.mjs
```

## 已知边界

- **最多 4 只桶、单个容量 ≤ 60、`∏(cᵢ+1) ≤ 20000`**（`js/core/jug.js:19-21`）。门槛不是建议：
  它是"构建期能穷尽、序列化后还能重解一遍"的全部依据，`validate()` 直接抛错而不是钳制。
- **63 关里没有一行用到多目标 `target` 数组、也没有一行带非空 `start`**：模型支持、测试支持
  （`test/jug.test.mjs` / `test/solve.test.mjs` 各有断言），但生成器不抽它们。
- 分注档（`decant`，par 12–20）在真手上是 12–20 次拖动，`solutions` 高得离谱（一行 3 090 条最短走法）；
  它存在的意义是印着可证的数字，不是"好玩"。
- 通关后没有彩带、没有音效、没有分享弹窗；分享只分享谜题本身（`#/lot/<id>`），不带战绩。
- Electron 壳过 `node --check`，但仓库不装 electron，**没有跑过真实启动**。
- 移动端断点（≤820px）已写、`touch-action: none` 已接，但**没有真机验证**（验收是 1280×800 桌面 headless）。
- 多语言：UI 只有中文。

## License

MIT © 2026 z-biz-game

## 上线的到底是哪一批文件

这个仓没有打包器：站点=一次文件拷贝。以前「拷哪些」写在 `pages.yml` 的 `run:` 里（手抄的几行
`cp`）。本地 `index.html` 直读仓库根，永远自洽；线上却按那份清单拷，于是页面后来引用的
`manifest.webmanifest`、`sw.js`、`icons/*` 可能一个都没上去——线上 404，而仓里的引擎测试与
真浏览器闸全绿，因为它们跑的都是仓库根，没有任何一步在「按清单拷」的那个环境下加载过页面。

现在清单只有一份，住在 `tools/assemble-site.sh`：CI 调它拷 `_site`，本地闸调它拷临时目录，
然后**对拷出来的产物**提要求（`tools/deploy-set.mjs`）：

- **W 清单与页面同源**：`pages.yml` 里必须真有 `run: bash tools/assemble-site.sh <dir>` 这一行，
  `ci.yml` 里必须真有 `run: node tools/deploy-set.mjs`。认的是调用那一行，不是文件里出现过这个
  路径——注释里本来就会写它，只 grep 字符串会被一句散文喂绿。
- **R 引用可达**：引用不靠手打名单。从 `index.html` 的 `href/src` 出发，凡解析出来是 `.js`/`.css`
  的就把那一站也扫一遍（CSS 的 `url()`、JS 去掉注释后的 `'./…'` 字面量、`new URL(x, base)` 的两种
  基、`navigator.serviceWorker.register`、`scope`），`manifest` 的 icons/screenshots/shortcuts 各自
  的 `src` 也算引用。取径上读不到的那一站本身就是红（读不到＝这一站根本没扫）。每条引用都必须在
  产物里且非 0 字节；绝对路径单列一条红，因为 Pages 挂在 `/<repo>/` 前缀下会跳出去。
- **P 位图不许说谎**：`manifest` 声明的 `sizes` 必须等于 PNG IHDR 的真实宽高——文件图标读文件头，
  内联成 base64 的图标先解码再读同一段。后一条不是可选项：仓里零二进制文件的承诺（本仓自己的测试钉着）
  只约束"有没有 .png 这个文件"，图标于是住在清单里；如果 P 段只筛文件名，声明写 512 而真图 192 就一路放行。
- **H head 的语法形状**：R 段拿 `index.html` 里的字符串当引用，标签没闭合它照样读得动，于是"少一个
  `>`"这一类坏法在 R 段全绿。H 段逐标签走一遍 head：标签之外只许出现空白，每个标签在自己的 `>` 之前
  不许碰下一个 `<`。两种坏法各有线上后果——少一个收尾的 `>` 会把下一条 meta 吃成前一条的 attribute
  （重复的 `content` 按规范丢弃，社交卡就少一句）；多一个裸的 `>` 是 head 里的非空白字符 token，
  解析器到此弹出 head，后面的 `<link rel="icon">` 不再由 head 认领，Chrome 转去要 `/favicon.ico`
  并 404，那一页的控制台从此不干净。
- **钉住自己的条数**：R 段实际检查的路径条数（`19`）与这一次跑的断言条数（`43`），钉在
  `tools/deploy-set.mjs` 顶部的那对常量里。没改页面却掉了，说明解析断了；删掉一张图标会同时
  少一条 R10 与那张的 P1/P2，所以两个数一起钉，断言条数能漂就是闸在缩水的信号。这一节故意只写数值、
  不写那对常量的名字：本仓原有的文档闸会拿"文档里出现过的同名标识号"回数它自己的条数（skyscraper
  的 D14b 就是这种钉法），两道闸共用一个名字就互相打红。H 段另钉一个数：它扫到的 head 标签条数
  （`14`），因为"标签之间只剩空白"只在真的扫到标签时才有意义，解析断在半路的语法检查比没有更坏。

`tools/deploy-set-selftest.mjs` 是这几颗钉的阳性证明：它把仓库复制到临时目录，照着每一类断言
各下一刀（X1 清单不收位图目录 / X2 模块边改名 / X3 CSS 写绝对路径 / X4 `start_url` 绝对 /
X5 删光 >=512 图标 / X6 少一个必填字段 / X7 声明尺寸与真图不符 / X8 workflow 不调脚本 /
X9 CI 不跑闸 / X10 是阴性对照——往入口 JS 追加一行只写在注释里的假路径，闸必须仍然绿、条数仍然
`19`、断言仍然 `43`；X11 og:image 退回相对路径 / X12 og:image 的前缀指向别的 slug /
X13 内联位图谎报尺寸——只在有靶子时下：X11/X12 要页面上那句 og:image，X13 要清单里真有一段 base64
图标，没有就打印 SKIP；反过来 X1 没有位图目录可砍时改砍 css，P 段一位都不核时台架直接报靶子不够；
X14 把 head 里第一个标签的收尾 `>` 删掉 → 必须点名 H3 / X15 在 head 中间插一个裸的 `>` → 必须点名
H2 / X16 删掉 head 里一条标签 → 必须点名那个 `14` / X17 是 H 段的阴性对照——往 head 里加一条含 `>`
与 `<meta` 字样的注释，闸必须仍然绿、条数仍然 `43`。这三把刀都按**位置**切而不按字面量找针：head 里
第一条是什么标签随仓漂，而坏法是形状不是字符串），
要求每一刀都让闸**点名**变红。靶子从 `DEPLOY_SET_DUMP=1`
的出处表现挑（取径真的会读的那支 JS / 那一张 CSS，不写死某一个仓的入口名），所以页面改了、仓与仓
不同，台架跟着走。

H 段不是照着假想的坏法写的：2026-10-06 本仓 `index.html` 的 `description` 那条就漏了自己的收尾
`>`，行尾还多出一个裸 `>`（同一份 appender 在 nikoli-loops 与 staircase 留下同一处，那边被浏览器闸
判红，这边 CI 全绿）。修之前把修复前的那份 `index.html` 放回副本里跑这道闸，三条点名红：

```
  FAIL H2 head 里标签之间只剩空白（多出的一个 > 就让 head 就地结束）  非空白片段 [">"]
  FAIL H3 每个标签在自己的 > 之前不碰下一个 <（少一个收尾 > 会把下一条 meta 吃成 attribute）  吞并下一条的标签体 ["<meta name=\"description\" content=\"倒水量：用几只没刻度"]
  FAIL H4 head 里解析到的标签条数等于钉在文件里的 EXPECT_HEAD_TAGS（14）  实际 13 条
部署集：19 条引用（含 4 张位图尺寸核对），失败 3 项
rows: 43 fail: 3   GATE_RC=1
```

同一份产物在修后的整闸里是 `=== ALL GREEN ===`、`GATE_RC=0`，`node tools/deploy-set.mjs` 打
`rows: 43 fail: 0`，台架打 `DS_SELFTEST rc=0`。没覆盖的那一半：H 段查的是**字节层面的标签形状**，
不查语义——`og:type` 少了一条但两条 meta 都闭合时它不红，那由 R7 与浏览器闸的社交卡断言管。

`node tools/deploy-set.mjs` 与 `node tools/deploy-set-selftest.mjs` 就是 CI 跑的那两条命令本身
（package.json 里的 `deploy-set` / `deploy-set:selftest` 只是同一支脚本的 npm 入口）；本仓的整闸在 `tools/verify.sh` 的 `=== deploy-set ===` 那一段也各跑一次。它们红的时候并进本仓那条出口的退出码——这一条是这么证的：
把 ci.yml 里那行 `run: node tools/deploy-set.mjs` 砍掉，本仓整闸必须点名红且退出码非 0。
所以「本地全绿、线上 404 自己的 manifest / sw.js / 图标」这一类坏法在本地就会红。
