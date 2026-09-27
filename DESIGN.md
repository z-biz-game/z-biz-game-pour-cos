# 设计文档 · 倒水量

面向维护者的技术说明：为什么这样实现、哪些约束一破就出 bug、契约禁止的"点击时现场搜索"与本仓允许的
做法边界在哪、四档难度的区间是哪一次实测产出的、结构量与计时量分别是谁。玩法与关卡清单见
[README.md](README.md)，真实存在且已验证的东西与改动表见 [deliverable.md](deliverable.md)。

文中所有 `file:line` 指本仓磁盘上的行号；所有数字下面都注了它是**结构量**（换个机器逐位可复现）还是
**计时量**（随负载漂移），分类规则见 §4.3。

---

## 1. 核心决策：可解性与难度由两套互不相干的机制判定

| 问题 | 谁回答 | 什么时候回答 | 产出 |
| --- | --- | --- | --- |
| 这道题**有没有**答案 | `js/core/theorem.js`（Bézout：`gcd(caps) \| need`） | 生成期当必要筛，面板解释文案也读它 | 布尔判据 + `reachableAmounts()` 的可见量集合 |
| 有答案的话**最少几次** | `js/core/solve.js` 的分层 BFS | 只在构建期（`tools/bake.mjs`） | `par`、`path`、`solutions`、`explored` |
| 玩家这一步算不算一步 | `js/core/game.js:44` 的 `legal()` | 每次指针松开的那一刻 | `{moved, reason}` |
| 这局玩得好不好 | `js/core/game.js:101` 的 `grade()` | 通关那一刻 | `perfect/clean/out` = 3/2/1 星，标签「分毫不差 / 尚有余量 / 总算量出」 |

关键在于第一行与第二行**不是同一段代码**。规格 `pour.md §0` 要的就是这个：主代理当年用穷举对过账
（`a,b ∈ 1..9`，525 / 486 个用例，0 处不一致），本仓把那次对账变成一条会红的测试，
而不是 README 里的一句话。

### 1.1 谁算了那个不定方程判据

`js/core/theorem.js` 全文 64 行，文件头把口径的边界写死了（`:5-19`）：

- **必要性对任意桶数成立**：任何时刻每只桶里的水量都是 `g = gcd(caps)` 的倍数（0 和 `cᵢ` 是，
  `pour` 移动的 `m = min(vᵢ, cⱼ − vⱼ)` 在两端都是 `g` 的倍数时也是）。所以 `g ∤ need` ⇒ 量不出。
- **充分性只对两只桶声明**（`:10-13`）：反复"灌满一只、往另一只倒、另一只满了就倒掉"就是把
  余数类 `mod g` 在圆上走一圈，所以 `g` 的每个倍数、直到 `max(caps)` 都能出现。
  这句话在本仓**不是靠注释成立的**，是靠 `test/bezout.test.mjs` 在 `a,b ∈ 1..9` 上穷举成立的。
- 三只、四只桶只享受**必要**条件：`js/core/make.js:122` 只用 `spec.need % gcdAll(spec.caps) !== 0`
  把"一定无解"的抽样丢掉，方向是安全的（必要条件只能否决，不能放行）；
  真正的判定权在 BFS。谁如果把 `canMeasureAny`（`theorem.js:38`）当成 k ≥ 3 的**充分**判据来收题，
  就会把"gcd 整除但状态图里其实到不了"的三桶题当成有解——这条没有测试能替它红，因为
  `theorem.js` 本身没撒谎，是调用姿势错了。所以 `theorem.js:15-19` 那段"充分性只对两桶声明"的
  注释与 §1.1 下面那张三路对账表要一起读；本轮还把那三行注释里一处**不存在的字段名**改成了
  实际行为（见 deliverable.md 改动表第 6 行）。

`test/bezout.test.mjs`（235 行，`node test/bezout.test.mjs`）为了"不参与打分"付出了代价：
它**不 import** `theorem.js`，而是自带一份手抄的减法 Euclid（`myGcd`）与一份用字符串键写出来的
独立可达集 BFS（`reachableGoal`），然后三路对账：

| 对账 | 问题 | 用例数（结构量，逐位可复现） |
| --- | --- | --- |
| 第一路 | `t ∈ 0..max(a,b)`，"任一只桶量出 t" | **606 问**，其中非零 **525 问** = 规格 `pour.md §0` 的第一个数 |
| 第二路 | `t ∈ 0..a`，"指定那只桶量出 t" | **486 问** = 规格的第二个数 |
| 第三路 | 三桶 6×6 抽样，"任一只" | **197 问**（非零 **161**） |

三路 `mismatches` 都是 `[]`，最大容量 `worst 100`（`a,b` 到两位数时同一套断言仍然跑）。
`eq(cases, 606)` 这种**把样本量本身钉成断言**的写法是故意的：以后有人为了省事把扫描范围缩小，
测试会红，而不是"照样绿但没跑几个用例"。

### 1.2 手算 fixture：3、5 量 4 的 par 必须是 6

`test/fixture.mjs` 里的 `CLASSIC` 是**手抄**的经典答案（6 步、唯一最短走法、路线逐动作写死），
期望值不从被测代码读。`test/solve.test.mjs:103` 直接比 `par`。真正防"搜索自己给自己打分"的是
`:112` 那条反证，它用另一个实现（`brute`，深度上限穷举）证明：

- 5 步之内 `brute` 返回 `null`，6 步恰好返回 1 条；
- 前 5 层里 5 号桶出现过的水量集合是 `[0, 2, 3, 5]` —— 4 不在里面，这才是"要第 6 步"的理由；
- 可达状态恰好 16 个，闭式算的是 `|(x∈{0,5}) ∪ (y∈{0,3})| = 8 + 12 − 4 = 16`（24 个编码里），
  逐层 `[1,2,3,2,2,2,2,2]`，最深的两个在第 7 层；
- 同一个 16 由 `reachAll`（把 `brute` 的提前退出拆掉）与 shipped 的 `census()` 各自独立量一遍 ——
  两个搜索器同意不算证据，所以第三路是那个闭式减法。

这条测试自己也被修过一次：早期版本问 `brute` 要"16 个状态"，拿回来的是 14，因为 `brute` 在
**第一个目标层**就返回（`test/solve.test.mjs:143-157` 的注释记着）。那是测试对自己仪器的误解，
不是搜索器错了 —— 遇到这种情况要改测试的问法，而不是改期望数字去迎合实现。

---

## 2. 状态图必须是有限的：三条不许弯的约束

### 2.1 `∏(cᵢ+1) ≤ 20000` 是门槛，不是建议

`js/core/jug.js:19-21` 写死三个常数：`SPACE_LIMIT = 20000`、`MAX_BUCKETS = 4`、`MAX_CAP = 60`。
`validate()`（`:175-203`）把它们变成逐条可指认的错误字符串，`test/jug.test.mjs:57` 一条一条打负例：
`'two buckets of the same capacity'`、`'need larger than the target bucket can hold'`、
`'start amount 5 outside bucket 1'`、`'state space 29760 over the 20000 ceiling'`。

为什么 20000 而不是 200000：这道门槛要保证的是**序列化之后还能重解一遍**。
`tools/bake.mjs:105` 对每一行入库题做 `solve(spec, { limit: 60000 })`，
`test/library.test.mjs` 在 CI 里对**全部 63 行**重解并比对印着的 `par / solutions / states / route`。
这两处都必须快到没人想加超时。shipped 池子里最大的是 `measure-12`：桶 `[4,8,11,12]` ⇒
编码空间 `5·9·12·13 = 7020`，可达 4 710 个（结构量）。放到 200 000 的话，
"重解一遍"就开始需要 `limit`，而一个需要 `limit` 的搜索器印出来的 `par` 是意见不是事实。

代价也如实登记：门槛越紧，高档位越难抽到题（`decant` 档实测有 3 474 次抽样因
`spaceOverLimit` 被拒，`node tools/bake.mjs` 的输出行）。

### 2.2 没有半倒

`js/core/jug.js:9-14`。三个原子动作 `fill / dump / pour` 是唯一可能的动作词表
（`actionSet()`，`:86`：每桶 2 个 + `k(k−1)` 个倒，2/3/4 只桶恰好 6/12/20 个动作，
`test/jug.test.mjs:15` 钉住了 6 这个数）。**"倒一半"被禁的理由不是麻烦，是它会毁掉本仓的全部主张**：
桶上没有刻度，"一半"不是一个玩家能认出的状态；一旦允许，状态就不是 `∏(cᵢ+1)` 里的整点，
而是连续统，于是 §2.1 的门槛、`par`、`solutions`、"序列化后重解"一起失去意义。
规格 `pour.md §1` 要求这条写在 DESIGN.md 里，它就在这里。

### 2.3 零变化动作不入队，也不计步

同一个判断只写一次：`jug.effective()`（`jug.js:117` 起）问"这一步会改变什么吗"，
`game.legal()`（`game.js:44`）就是 `!game.done && effective(...)`。
于是搜索的入队规则和玩家的计数器不可能各说一套 —— 这是"屏幕上那个步数"与"证明值"能对上前提。

`test/solve.test.mjs:227` 说明为什么这是 BFS 在这里能停下来的原因之一：单桶情形下
`fill` 与 `dump` 互为逆操作，把"灌满一只已经满的桶"当成后继，等于给每个结点加一条自环。
（诚实补充：`solve` 有 `visited` 表，自环状态会因为已访问而被跳过，所以真正会坏掉的不是终止性，
而是"每一步都被复制出一份同深度的后继"—— 结论同样是这条判断必须存在。）

面板侧的可观察后果：`game.act()` 返回 `{moved:false, reason:'no change'}`（`game.js:50-53`），
`main.js` 的 `commit()` 是唯一入口，所以"零变化不计步"只需要在一处成立。
浏览器层的 `@pointer` 有 5 条真鼠标断言钉它（原地按、倒进满桶、空桶对龙头、抽干空桶、拖回原桶）。

---

## 3. 一次 BFS 产出两个可印数字

`js/core/solve.js` 是分层 BFS，用平行数组（`dist/prev/via/ways`）而不是 `Map<code, object>`，
理由和 `jug.apply` 的 `into` 参数一样：两万个状态不该分配两万个对象。

- `par`：目标所在层的深度。**多目标**（`target` 是数组）时是"到任意满足态"的最短距离，
  判定函数是 `jug.isGoal()`；`test/solve.test.mjs:204` 用两个单目标 par 手推出多目标应当取的值。
- `solutions`：**同层最短路线条数**。所以搜索**不能**在看见第一个目标时返回
  （`solve.js:9-12` 的注释），它要把目标那一层走完，再对整层求和 `ways`（`:82-85`）。
  这是面板上"最优走法 M 条"的出处，也是本仓第二个可印数字。shipped 最大 3 090（`decant-04`）。
- `explored`：搜索访问过的状态数；`census()`（`:97`）另走一遍完整可达图，产出 `states` 与 `depth`。
  两个数字故意分开：一个 6 步、全图只有 16 个状态的题是一道算术练习，同样 6 步、穿过 2 000 个
  状态的题才是谜题。面板印后者。

### 3.1 两个刹车都必须"承认自己没跑完"

`solve(spec, { limit = 400000, deadline })`：结点预算超了置 `truncated`，
时钟到点也置 `truncated`，两种情况都返回 `par: -1`、`path: []`（`solve.js:79`）。
这条语义是主张的一部分：**没跑完的搜索不许印难度数字**。
`test/solve.test.mjs:264` 用一个已知形状的图钉两端：16 状态的 `CLASSIC` 给 8 个结点预算 ⇒
`truncated` 且 `par === -1`；同一道题给 14 ⇒ 恰好答出 6，而且 `explored` 正好 14
（两个第 7 层状态永远碰不到）——预算的粒度被量出来了，不是"给个小数字就会截断"这种空话。

### 3.2 时钟轮询为什么在循环顶部（一个真实踩过的坑）

`solve.js:52-54` 的注释记录着：`deadline` 的轮询原来放在"跳过已访问层"的 `continue` **之后**，
于是**已经找到目标、正在走完目标层尾巴**的那次搜索永远不看钟，调用方给的 deadline 被静默忽略；
`tools/bake.mjs` 的每档预算形同虚设。现在轮询在循环体第一句，`gi & 255` 每 256 个结点一次
（每结点调用 `Date.now()` 会把 BFS 拖慢一个量级）。
测试侧的对应变化：`test/solve.test.mjs:280-291` 改用 `{13,14,15}` 量 15 号桶的 7 这个
真实超过一次轮询的题（1 176 个状态、13 步），过期 deadline 现在停在第一次展开之前。
教训：**测截止条件，要用一个"确实要跑很久"的输入**；在 16 个状态的图上把 deadline 设成过去，
只能测到实现里那条最不经用的路径。

---

## 4. 难度带的数字是哪一次实测产出的

### 4.1 两个"带"不是同一个东西

| 名字 | 在哪 | 是什么 | 谁校验 |
| --- | --- | --- | --- |
| `TIERS`（生成包络） | `js/core/make.js:167-185` | 抽样允许的 `par` 区间 + 桶数/容量范围 + 两次刹车（`tries` / `deadline`） | `test/make.test.mjs` 断言四档边界为 `drip 4-5 / measure 6-7 / blend 8-11 / decant 12-20` 且互不重叠 |
| `TIERS_META`（已发布） | `js/data/lots.js` 第 6 行 | **从入库行里量出来**的 min/max/桶数范围文案 | `test/library.test.mjs:114-134` 重算 min/max/桶数并比对文案 |

UI 印的是第二行那个。写文档或改代码时别把它们混成一句"难度区间是 4–20 次"。

### 4.2 带是从抽样分布里读出来的，不是先定再凑

`node test/balance.mjs`（默认 `CALLS=80`、`TIER_MS=20000`、每次抽样给 120 ms）本机输出：

```
drip      4-5     160    160      100.00%  4.5     616        0     42     no   bandLow 988, bandHigh 744, gcdReject 588, needIsACapacity 372, pureTransfer 190
measure   6-7     160    160      100.00%  6.5     8736       0     183    no   bandLow 4013, needIsACapacity 1040, gcdReject 1003, bandHigh 743
blend     8-11    320    270      84.38%   9.2     1144       0     3031   no   bandLow 115576, needIsACapacity 25302, gcdReject 24943, bandHigh 7997, gaveUp 50
decant    12-20   640    336      52.50%   14.9    168        0     20001  yes  bandLow 595529, needIsACapacity 91510, gcdReject 89379, bandHigh 18521, spaceOverLimit 9871, gaveUp 304, truncated 21, timeout 1
totals: drawn 1280, accepted 926, 23.3s
```

每个拒绝码都指到一行代码：`bandLow` / `bandHigh` 是 `make.js:126-127` 的带过滤，
`gcdReject` 是 `:122` 的定理筛，`needIsACapacity` 是 `draw()` 里的廉价结构筛（`make.js:90`，
`need` 恰好等于某只桶的容量 ⇒ "灌满它再倒掉"，不必搜索就平凡），
`pureTransfer` 见 §4.4，`spaceOverLimit` 是 §2.1 的门槛，`gaveUp` / `timeout` / `truncated`
是两次刹车。

**为什么 `decant` 的样本量最少**：那一档 `cut = yes`，20 秒 `TIER_MS` 到点，`par 20` 的名额没填满。
这正是 §4.3 要分开记的东西：同一次会话里换一次负载再跑，`decant` 是 682→378、55.43%、中位 15.5，
而 `drip / measure / blend` 三档的 `drawn / accepted / rate / median / maxStates` **逐位相同**。

规格 `pour.md §3` 要的直方图是"5 000 题"量级的，默认台架只有 926 道，所以本仓也按规格的口径放大跑了一次
——不用改代码，换两个环境变量就够（`2:09` 那一跑）：

```
$ CALLS=430 TIER_MS=180000 node test/balance.mjs
drip      4-5     860    860      100.00%  4.5     616        0     200    no   bandLow 5015, bandHigh 3990, gcdReject 3192, needIsACapacity 2000, pureTransfer 1028
measure   6-7     860    860      100.00%  6.5     8736       0     949    no   bandLow 22564, needIsACapacity 5794, gcdReject 5689, bandHigh 4162
blend     8-11    1720   1440     83.72%   9.2     1144       0     16895  no   bandLow 637228, needIsACapacity 139533, gcdReject 136357, bandHigh 44970, gaveUp 280
decant    12-20   3870   2278     58.86%   15.8    168        0     111517 no   bandLow 3226890, needIsACapacity 496423, gcdReject 482565, bandHigh 96896, spaceOverLimit 53003, gaveUp 1592
par histogram per band (draw order): 4:430 5:430 6:430 7:430 8:430 9:415 10:430 11:165 12:430 13:128 14:430 15:0 16:430 17:0 18:430 19:0 20:430
totals: drawn 7310, accepted 5438, 129.6s
```

两件事从这一跑里才看得清，而且它们都是**结构量**：

1. 四档的排序与宽度在小样本里就是对的：把样本放大 5.9 倍，`drip/measure/blend` 的
   `median / maxStates` 一个字没变（4.5 / 6.5 / 9.2，616 / 8736 / 1144），`blend` 接受率
   84.38% → 83.72%。带不是被调出来的，是量出来的。
2. `par 15 / 17 / 19` 在 `decant` 档**抽不到**（各 430 次机会，0 道），`par 13` 只有 128/430、
   `par 11` 只有 165/430。这不是预算问题（这一跑 `cut = no`），是"2–4 只桶、容量 3–14"这个
   桶集合的奇偶结构：`pour.md §3` 说的"四档互不重叠"成立，但**带内不是每个 par 都同样可达**。
   `tools/bake.mjs` 因此会打一条 `note: decant drew no puzzle for par 15,17,19; band ships 6 of 9 values`，
   这是设计，不是失败。


### 4.3 结构量与计时量

| 结构量（逐位可复现，换机器也一样） | 计时量（本机本次实测，会随负载漂移） |
| --- | --- |
| `par / solutions / states / depth / route`（每行都由 `test/library.test.mjs` 重解比对）、`∏(cᵢ+1)`、动作数 6/12/20、`SPACE_LIMIT / MAX_BUCKETS / MAX_CAP`、Bézout 的 606/525/486/197/161 与 `mismatches []`、`CLASSIC` 的 16 个状态与逐层 `[1,2,3,2,2,2,2,2]`、四档的 `par` 边界、shipped 池 `n = 16/16/14/17`、`node` 层 84 行 / 871 条、`browser` 层 130 行 | `bake` 总耗时（本机 7.5 s / 7.8 s 两跑）、`balance` 的 `ms` 与 `decant` 的 `drawn/accepted/median`、`node --test` 的 `duration_ms`（95 ms）、headless Chrome 单段墙钟、每档被 `TIER_MS` 截断的位置 |

判据很简单：**期望值写死在断言里的都是结构量；只出现在打印行里的都是计时量**。
`test/make.test.mjs` 因此只断言"带不越过包络 / 同一 seed 同一题 / 门槛生效"这类形状，
不断言"某一档应当量出多少道题"——后者是计时量，把它写进断言就会在别的机器上随机变红。

### 4.4 规格里那条筛题规则在本模型下永远不会响

`pour.md §3` 要求把"`k=2` 且一眼可见"的题用"解里 fill 占比 > 80%"筛掉。
它筛不掉任何东西，而且原因可以说清：水从龙头打进来之后，必须至少被倒走一次（倒进别的桶或倒掉）
才会出现答案，所以任何认证解里 `fills ≤ par/2`，即 `fillShare ≤ 0.5`。
`test/make.test.mjs` 把这条当成**模型性质**在断言（实测上界恰好 0.50）。
于是 `routeFeatures()`（`make.js:32`）仍然打印 `fillShare`（它是一个被量的数，不是一条被执行的规则），
而 80% 那条规则真正想拦的那一族题改由 `pureTransfer` 拦：`dumps === 0` 且 `par ≤ 4`
（`TRANSFER_PAR_MAX`，`make.js:30`）⇒ 一路纯倒来倒去、一滴不浪费，那是算术读数不是测量题。
它在本次 `drip` 档抽样里真的开火 190 次（上表）。**与规格不同之处在这里，本仓没有照抄那个阈值。**

### 4.5 为什么接受率随"名额"塌下去

`node tools/bake.mjs` 的 `accept` 列（README 贴了整张表）从 `drip` 的 4.94% 掉到 `decant` 的 0.01%。
不是抽不到题，是**同一个 par 值下能抽到的不同桶集合太少**：`bake` 按 par 轮询取名额
（`perWanted`，`bake.mjs:66`），并用 `signature(spec)`（`:42`）把
"同一组容量 + 同一目标 + 同一个 need"的重复题丢掉，所以名额越大、去重砍得越狠。
`blend` 档因此只凑到 14 道（`warn: blend only reached 14 puzzles across pars 8,9,10,11`），
`decant` 凑到 17 道且只覆盖 9 个 par 值里的 6 个（`note: decant drew no puzzle for par 15,17,19`）。
这是**如实发布**的选择：宁可少几道、诚实印出 `TIERS_META`，也不把凑不满的 par 用重复题填满。

---

## 5. 运行期到底做了什么（契约边界）

`BUILDER.md` 允许下界的口径是"点击时只允许 `limit=2` 早停，全枚举只在 bake/proof"。
本仓比这条更严：**玩家点击时一次搜索都不跑**，连 `limit=2` 都不需要，因为没有任何东西要数——

- 合法性与计数：`game.js:44/:50`，两个数组比较加一次 `apply`。
- 提示：`game.js:90` 的 `hint()` 只读烘焙好的 `route`，玩家一旦离开认证路线它返回 `{off:true}`，
  **不**现场重搜（`:86-89` 的注释就为这件事写着）。要"离开路线后还给建议"就得在点击时搜索，
  那正是契约要挡的：搜索的上界一旦挂上玩家行为，`par` 就从事实降级成意见，而且浏览器会卡。
- 每日题与随机题：从 `js/data/lots.js` 那 63 行里查（`library.js:31 pick`），生成器 `make.js`
  在 shipped 图里**根本不被 import**。
- 这条边界不是文档承诺，是断言：`@boot` 里有一条
  `the browser does not search: the solver and the generator were never fetched`
  （`tools/playtest.mjs:563`），它读 `performance.getEntriesByType('resource')`，
  只要 `solve.js` 或 `make.js` 出现在模块请求列表里就红；紧挨着的一条正向断言
  `js/data/lots.js` 确实被 fetch 了（`:566`），防止"什么都没加载所以当然没搜索"这种假绿。

`pour.md §1` 那句"这样 BFS 在浏览器里也是毫秒级，但**仍然**只在构建期算 par 与路线"就是本节的依据。

### 5.1 三层不许互相串

| 层 | 文件 | 可以知道 | 不许知道 |
| --- | --- | --- | --- |
| 模型 / 搜索 / 数论 | `js/core/*.js` | 容量向量、编码、BFS、存档结构 | `window`、`document`、canvas |
| 画面 | `js/view.js` | 像素、指针坐标、预览水位 | 任何合法性判断（只**问** `game.legal`） |
| 外壳 | `js/main.js` | 路由、DOM、存档写入、`window.pour` | 搜索、生成 |

`test/shape.test.mjs:41` 是字面量扫描（`window.` / `document.` / `navigator.` / `localStorage.getItem` /
`requestAnimationFrame` / `getContext` / `canvas` 都算泄漏），唯一豁免是 `js/core/storage.js`，
而它被钉成"全仓恰好一处 `globalThis.localStorage`"（`:55`）。
豁免的理由是它的职责：没有 `window` 也要能跑，所以 `try/catch` 包住而不是 `window.` 起头
——`file://` 和某些隐私模式下 `localStorage` 是**抛异常**而不是返回 `null`。

### 5.2 存档的单调性是语义不是实现细节

`js/core/storage.js:9` 全仓一个键 `pour.save.v1`。`best` 只降不升、`unlocked` 只升不降、
清档连内存缓存一起换（留一份陈旧缓存比不清档更糟：屏幕说清了、纪录还会回来）。
`test/storage.test.mjs`（16 行断言 / 392 行）跑的是四种环境：无 `localStorage`、
每次调用都抛、属性访问就抛、以及"上一次页面写的盘"。浏览器侧 `@save` 用真实的两次点击清档。

---

## 6. 手势：状态机之外的那点几何

`js/view.js` 的 `measure()`（顶部注释 `:15-22` 有常量）把画布切成三条带：龙头带 `TAP = 78` 高在上、
桶身（`scale = clamp(availH / maxCap, 7, 46)`，`availH = H − 28 − TAP − DRAIN`）在中、
下水道带 `DRAIN = 58` 在下。三条判据：

- `zoneAt()` 返回 `{z, i}`，桶身判定上下各让 4 / 8 px，其余落进缝里返回 `'none'`；
- `actionOf()`（`:147`）**由起手位置决定动作对象**，不是由指针当前压着哪一列决定 —— 这是过拖
  不改变答案的原因；起手桶拖回它自己 ⇒ `null`（取消）；
- `track()`（`:161`）算两个数：`over` 是**未钳制**的投影（测试用它证明手指真的越过了桶沿），
  `progress` 是钳到 `[0,1]` 的那一个（预览水位用）；非法拖动的 `progress` 恒为 0，
  所以"预览"不会替一笔试图骗人。
- `move()` 的 target 是**粘滞**的（`:202-204`）：路过两个桶之间的缝隙不会把已经锁定的目标洗掉。
  这条曾经以另一种方式坏过，见 §7.2。

`window.pour`（`js/main.js:406`）暴露 `state / pool / load / route / pos / play / actions /
bucketPoint / faucetPoint / drainPoint / dragState / hintOnce / undoOnce / store / ops`。
三个 `*Point()` 走的是 `view.toClient()`（`view.js:134`）——返回**视口 client 坐标**，
外加 `scale` 与 `bw`，所以台架可以算"越过右沿 8 px 以外"这种几何条件而不必猜实现里的布局。

---

## 7. 验证台架

### 7.1 为什么是 CDP 而不是 Playwright

`package.json` 的 `dependencies` 与 `devDependencies` 都是 `{}`（`test/shape.test.mjs:62` 钉着，
并且连"import 里出现非相对、非 `node:` 的裸模块名"都算失败）。Node 21+ 自带全局 `fetch` 与
`WebSocket`，`tools/playtest.mjs` 用它们直讲 CDP（`Input.dispatchMouseEvent` /
`Input.dispatchKeyEvent` / `Page.captureScreenshot` / `Runtime.evaluate`）就够了，
还顺带能拿到 `performance` 资源列表这种 Playwright 不便宜的东西。

### 7.2 `@pointer` 的 40 行是干什么的，以及它为什么曾经红 6 行

页面内注入 JS 能证明 `commit()` 对，**证明不了手指点得着**。`pointerScenario`
（`tools/playtest.mjs:184`）全部动作走真实 `Input.dispatchMouseEvent`，坐标只来自
`window.pour.*Point()`。它断言：整条认证解（`drip-01`，par 4）用真鼠标拖到通关、★★★ 卡片印的是
量出来的数字、原地按不动、非法拖动（倒进满桶 / 空桶对龙头 / 抽干空桶）不计步也不动一滴水、
拖回原桶=取消、过拖保留意图且水位钳在沿口、以及一条容量不变式
（`no bucket is ever asked to hold more than its capacity`）。

这一轮它先红了 6 行，两条根因都值得记下来，因为它们都是"台架在骗人"而不是"实现错了"：

1. **一步跳到目标区外，等于没瞄准。** 原来的过拖段落从起手桶直接发一个 `mouseMoved` 到
   所有区域之外的坐标。视图的 target 是粘滞的，而粘滞只记录**真的进过**的区域，
   所以那次拖动的意图从来没被登记：`dragState()` 报的是 `target = 起手桶, action = null`。
   修法是老实走位：先 `mouseMoved` 进目标桶（读出 `aimed`），再往外走到 `way`。
   同时"越过去多远"改成**由几何自己算**（把 `way` 用 `dst + v` 投影出来再算 `want`），
   于是断言 `|over.over − want| < 0.06` 量的是实现，不是实现的自述。
2. **4 步插值进不了 78 px 的龙头带。** 抬起一只桶往龙头拖，原来只采 4 个点，
   在桶身高达 414 px 的布局下没有一个点落进龙头带，预览分数因此无从谈起。
   现在走 40 步，并且断言取的是**视图自己报告的第一只落进龙头的那一步**
   （`lift` 那一步要求 `target.z === 'tap'` 且 `action.op === 'fill'`），
   所以"进了区、还没碰到龙头 ⇒ `0 < progress < 1`"与"碰到龙头 ⇒ `progress > 0.9`"
   是被同一次真实运动分先后钉住的。
3. 附带发现：原段落要求"过拖之后 `moves === 1`"，同时又要求那次拖动真的倒了水——
   fill 一步 + pour 一步，那条断言**本身**是错的。现在计步基准显式取为 `afterFill + 1`。

三条都是加严（改成真实输入、加计数器基准、加非法倒水与容量不变式），没有动任何 core 期望值。

### 7.3 等的是 shell，不是秒表

`Page.navigate` / `location.hash=` 之后轮询 `window.pour.state.id`（`tools/playtest.mjs:109`），
`tools/verify.sh` 也一样：先轮 `/json/version` **和** web 根目录都活，再跑场景，
每段结果用**花括号计数**从 console 里截 JSON（headless 会在同一行后面追加文本，
`JSON.parse(整行)` 是随机失败）。profile 目录 `mktemp -d`，`trap cleanup EXIT` 里 `wait` 掉两个后台
PID —— 脚本头注释就把这条承诺写在第一句（`tools/verify.sh:3-4`
"Everything the script starts exits with the script"），并且明令**不要**加
`--use-gl=angle --use-angle=swiftshader`（软件光栅会占满核心，而且没有 CDP 客户端时 Chrome 不会自己退）。
端口是 `CDP_PORT=9341 / WEB_PORT=5190` 两个可覆盖的默认值（`verify.sh:19-20`）。

覆盖默认值这件事本身就是礼节的半个理由：这台机器同时只允许一个 headless Chrome。
**跑之前 `pgrep -fl remote-debugging-port` + `lsof -nP -iTCP -sTCP:LISTEN | grep -E ':(93[0-9][0-9]|51[0-9][0-9])'`，
跑完再查一遍 `node server.cjs`**。脚本能保证自己不泄漏，但它不知道别人占了哪个端口，
更不能保证上一个代理留下的 orphan 不会冒充它——`SKIP_UNIT=1` 的第一次实跑就撞上过一次
（9341/5190 上的 Chrome 与 `server.cjs` 都活着，`cwd` 属于本仓，进程却是上一位留下的：
端口语义上"是本仓的"，验收结果却可能是别人的）。处理方式是只杀 `cwd` 属于本仓的那两个 PID，
其它仓的 Chrome 一个不碰，然后换 `CDP_PORT=9346 / WEB_PORT=5196` 重跑。

### 7.4 已知的一条 console warning（不改 shipped 代码，写在这里）

`verify.sh` 末段会把 console 打出来（`node tools/playtest.mjs logs`）。本机每次有一条：

```
[log:warning] Canvas2D: Multiple readback operations using getImageData are faster with the willReadFrequently attribute set to true. ...
```

台架收集 console 的过滤条件是 `level === 'error' || source === 'rendering'`
（`tools/playtest.mjs:92`），所以这条性能提示会被抓出来**给人看**，但它不是一条断言，
也不影响任何行的通过与否。它来自**台架自己**用 `getImageData` 回读像素（证明"画布真的画了东西"），
而上下文是 `js/view.js:50` 的 `canvas.getContext('2d')` —— 属性不能在事后补。
本仓没有为此把 shipped 上下文改成 `{ willReadFrequently: true }`：那条属性会把水面渐变与每帧重绘
推到 CPU 后端，为了消一条测试噪音去改 shipped 渲染路径是反的。（九连环那仓走了另一条路，
它的 `view.js` 带着这个属性；两种选择都自洽，但**别在 pour 里照抄**，因为这里警告来自台架。）


---

## 8. 刻意不做的东西（规格 §7 + 本仓自己的）

- **不做半倒 / 流动速率 / 水的物理**（`pour.md §7`）。理由不是"麻烦"，是 §2.2：
  状态一旦连续，`par`、`solutions`、`states` 全部失去"可证"的含义。
- **不做无限桶、不做 5 只以上桶**：`MAX_BUCKETS = 4` 且 `∏(cᵢ+1) ≤ 20000`。
  4 只桶时动作数已经是 20，容量再宽一点就撞门槛。
- **不做点击时现场搜索**（包括"只允许 `limit=2`"那种放宽）：§5。
- **不做成就 / 排行榜 / 签到 / 云存档 / 分享战绩**（契约 §5，E 组禁令）。
  分享只分享谜题本身（`#/lot/<id>`、`#/random/<tier>/<token>`），不带分数。
- **不加图片 / 音频 / 字体 / 打包器 / npm 依赖**：0 个二进制资产，`node_modules` 不存在。
- **不做"只有文件没有接线"的生成器**：`js/core/make.js` 与 `js/core/solve.js` 在 shipped 页面里
  不被 import，`@boot` 用资源列表钉住这一点；它们不是幽灵功能，是构建期工具，
  由 `tools/bake.mjs` 与 `test/` 接线。
- **不做非空 `start` 与多目标行的出题**：模型与测试都支持（`jug.validate` 会校验 `start` 向量，
  `isGoal` 处理目标数组），但 63 行产物里 0 行用到。想开这一族要同时改 `draw()` 的抽样与
  `trivialReason()` 的筛子——`start` 非空时"两步之内"的判定不再是显然的。

## 9. 实测出的边界

- `decant` 档 9 个 par 值里有 3 个抽不到题（15 / 17 / 19），加大预算也不来（§4.2 的 5 438 题跑法里
  仍然是 0），所以它 `TIERS_META` 写 `12-20` 而实际发布的是 `{12,13,14,16,18,20}` 六个值。
  带内 par 不等距这件事，规格没写，本仓把它写在两处：`bake` 的 `note:` 行与这里。

- 全池最大可达图 4 710 个状态（`measure-12`）；最大 `solutions` 3 090（`decant-04`，
  5/9/14 量 7）——"最短走法有 3 090 条"这类数字是本仓愿意印、而别的实现通常只能猜的东西。
- 面板上"可游荡"读的是 `census()` 的 `states`，它是**可达**集合而不是 `∏(cᵢ+1)`：
  `measure-12` 的编码空间是 7 020，能游荡到的是 4 710。两个数在 UI 与文档里必须分开说，
  混起来的后果是 `test/library.test.mjs` 里那条逐行复解会指出你不知道它在指什么。
