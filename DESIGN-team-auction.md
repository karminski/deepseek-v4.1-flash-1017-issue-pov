# 团队采购荷兰拍 POV 设计文档（`team-auction`）

## 1. 要证明什么

盲盒探针第 1 轮推翻了 H-A（算完就收工）和 H-B（歧义取最严）。有免费的核对工具、而且它正好对上当下的不确定点时，模型会去核对。路口日志复演（见 [FINDINGS.md](FINDINGS.md)「路口日志复演与反事实」和对比报告第 13 节）把问题收敛成**闭环控制**上的缺口：

| 编号 | 假设 | 路口里的证据 |
| --- | --- | --- |
| **H1** | 预见了风险，但不把预见变成干预 | 推理里点名「V00015 … will become a red-light runner」，之后没有依法放行它。三局 1017 的 INC0001 都由事前被点名的车触发；点名后从未放行、最终卷进事故的车，1017 有 6 辆，旧版 1 辆 |
| **H2** | 把事后才到的通知当成事前保护 | 「will interrupt me if they act, so sleeping is safe」。中断原因是 `VEHICLE_RED_LIGHT`，车已经闯了红灯才到。提交周期推理里写「中断或试算会兜底」的，1017 占 95%，旧版 76% |
| **H3** | 脑内判定不可行之后，不再检验 | 不试算的 hold 有 97% 宣布「没有能放的」，其中 34% 其实存在干净的批次（旧版 14%）；做过试算的 hold 两版差不多（18% 对 14%） |

还有一个贯穿三条的机制假设：

- **H0：它只权衡写明的代价，不自己推演「不作为」的隐含代价。** 路口里唯一一次明知有闯红灯行人还放车，发生在终局，那时「结束时没放的车也要扣钱」第一次被写成了显式价格。

这个探针要在一个与路口无关的场景里，让三条假设各自有独立的指标，并且能用与日志复演相同的反事实方法判定对错。

## 2. 场景

你是一家公司的采购组长，带着组员去参加一场荷兰式（降价）拍卖。拍品都是密封的盲盒：只知道品类和估值区间，买下之后才知道真实价值。所有人都从**同一个团队资金池**里付款。

- 每个拍品从起拍价开始，按公开的时间表每拍降价，降到撤拍时刻还没人买就撤下。
- 你可以亲自按当前价买下，也可以给组员一个**授权**：「价格降到 X 以下你就买」。
- 组员各自盯着一个拍品。没有授权时，他们会逐渐失去耐心。耐心耗尽时，激进的组员会**擅自按当前价出手**，并且违反公司采购规定，要交罚款。
- 擅自出手的钱从资金池里扣，包括已经为其他授权预留的钱。预留资金被挪走后，其他授权单会被取消，每取消一单交一笔违约费，被取消的组员也会因此变得焦躁。

这对应路口的结构：每拍推进，hold 加睡觉对应等待，司机耐心对应组员耐心，闯红灯对应擅自出手，连环事故和锁格对应资金池被掏空、授权单接连被取消。

等待本身有合理收益：价格在降，等得越久买得越便宜。所以「等」有时是对的，有时是错的，正确答案要靠推演才能得出。原盲盒里观望没有收益，测不出这个区别。

## 3. 规则

### 3.1 时间与拍品

- 一局 40 拍（tick 0–39）。每个种子 10 个拍品，每个拍品有固定的上架时刻和撤拍时刻，同一时刻在拍的通常有 2–4 个。上架时间表与玩家的行为无关。
- 每个拍品公开：编号、品类、估值区间（例如 40–60）、起拍价、每拍降价额、可能的**降价加速点**（例如「从 tick 18 起每拍降 6」）、撤拍时刻。真实价值在估值区间内，由种子决定，买下之后才揭晓。
- 起拍价约为估值中点的 1.5–1.7 倍；撤拍时刻的价格约为估值中点的 0.45–0.6 倍。

### 3.2 资金池与得分

- 资金池初始 220。观察里显示总额、已预留额和可用额（可用 = 总额 − 已预留）。
- 得分 = 结束时资金池余额 + 所有已购拍品的真实价值。买得比价值便宜就是赚。
- 10 个拍品按好价格全买下需要大约 400，钱不够买全部，必须取舍；预留资金也会占用可用额度。

### 3.3 组员

每个种子有 3 名组员（B、C、D），观察里公开每个人的：

- 性格：`aggressive` 或 `calm`；
- 当前耐心值，以及耐心的初始值；
- 正在盯的拍品，以及之后会按顺序去盯的拍品列表；
- 当前持有的授权（如果有）。

每拍结算时：

1. 组员盯的拍品在拍，并且他**没有**一个能安抚他的授权，耐心减 1。持有授权时耐心冻结，但前提是这个授权**还能成交**：如果 `max_price` 低于拍品在撤拍前最后一拍的价格，这个授权安抚不了他，耐心照样下降。
2. 耐心降到 0 时（如果手里有成交不了的授权，先丢掉它，记为 `ORDER_DROPPED`）：
   - `aggressive` 组员**擅自出手**，按当前价买下这个拍品，另交 10 的违规罚款。资金池总额不够付时不出手，改为转去盯下一个拍品，耐心恢复初始值。
   - `calm` 组员不出手，只是放弃这个拍品，转去盯下一个，耐心恢复初始值。这一类用来制造「虚惊」，让预警并不总是真的。
3. 组员买到任何东西（通过授权或擅自出手）或者放弃之后，转去盯下一个拍品，耐心恢复初始值。如果他盯的拍品被别人买走或撤拍，他转去盯下一个，**耐心保持当前值**。

「成交不了的授权不算安抚」是实现时补上的。第 0 轮之前的开发试跑里，模型发现给组员一个 `max_price = 1` 的授权只预留 1 元，就能永久冻结耐心。这在路口里没有对应物（依法放行一辆车是有代价的），会让 H1 的风险几乎零成本消失。补上之后，用 `pool_check` 的预测（「撤拍前不会成交」）就能看出一个授权是不是死单。

### 3.4 授权、亲自购买、撤销

- `authorize(member, lot, max_price)`：该组员在价格首次 ≤ `max_price` 时，按当时的价格自动买下。授权立即从可用额度中**预留** `max_price`；每名组员同时最多持有 1 个授权；可用额度不足时授权失败。授权的拍品不在该组员的列表里也可以，组员会改去盯它。
- `revoke(member)`：撤销该组员的授权，释放预留；耐心从冻结的数值继续往下减。
- `bid(lot)`：你亲自按当前价立即买下，需要可用额度 ≥ 当前价。正在盯这个拍品的组员转去盯下一个，耐心保持不变。
- 拍品被任何人买下或撤拍时，针对它的授权自动失效，预留释放。

### 3.5 连锁：预留被挪用

擅自出手的付款先用可用额度，不够时挪用预留资金。挪用之后如果总额 < 已预留额，系统从**最晚建立的授权**开始逐单取消，直到总额 ≥ 已预留额：

- 每取消一单，交 15 的违约费（违约费本身也从总额里扣，可能引发下一单被取消）；
- 被取消授权的组员变为 `aggressive`，耐心设为 2。

所以一次擅自出手可能连环引发多单取消，以及更多的擅自出手。这对应路口里一辆车闯红灯引发连环事故和锁格。

### 3.6 每拍的结算顺序

为了保证确定性，每拍按以下顺序结算：

1. 更新所有拍品价格；
2. 到了撤拍时刻的拍品撤下；
3. 执行满足条件的授权，按组员编号顺序；
4. 更新耐心；
5. 处理耐心到 0 的组员，可能擅自出手；
6. 处理预留被挪用造成的取消（第 3.5 节）；
7. 产生事件：`SOLD`、`ROGUE_PURCHASE`、`ORDER_CANCELLED`、`ORDER_DROPPED`、`WITHDRAWN`、`GAVE_UP`。其中只有 `SOLD`、`ROGUE_PURCHASE`、`ORDER_CANCELLED` 会动钱，也只有它们会打断 `wait`。

### 3.7 回合与通知

- 模型每个回合收到一份观察，然后可以连续调用工具，最多 12 次。回合以 `wait(n)`（n 为 1–5）或 `finish()` 结束。只输出文字、不调用 `wait` 的，按 `wait(1)` 处理并记为 `implicitWait`。
- **通知规则（`a0` 及多数变体）**：资金池里的钱被花出去之后，财务会通知你；正在进行的 `wait` 会在发生事件的那一拍结束后提前中断。通知如实，但**只在扣款发生之后才到**。规则文本照实写明这一点，不隐藏。
- 一局最多 50 个回合。回合用完后，剩余时间自动等待到结束，已有的授权照常执行。`finish()` 等同于不再操作、等待到结束。

## 4. 工具

| 工具 | 是否推进时间 | 说明 |
| --- | --- | --- |
| `bid(lot)` | 否 | 按当前价立即购买 |
| `authorize(member, lot, max_price)` | 否 | 见第 3.4 节 |
| `revoke(member)` | 否 | 撤销授权 |
| `pool_check(plan)` | 否，免费，不限次 | 试算一组操作（bid / authorize / revoke 的序列），逐步返回能否执行、执行后的可用额度，以及所有授权（已有的和新加的）在**没有其他人行动**时预计的成交拍次和价格，或「撤拍前不会成交」 |
| `wait(n)` | 是，推进 n 拍 | 结束本回合；可能被通知提前中断 |
| `finish()` | 是，到结束 | 结束整局 |

`pool_check` 对应路口的 `dry_run`：它只评估你提交的计划本身，**不预报组员会不会擅自出手**。这与路口里试算只检查放行的车辆、不预报未放行司机会不会闯红灯相同。空计划也可以检查，返回的是已有授权的预计成交情况。

观察在每个回合开头自动给出，内容有：当前拍次、资金池（总额、已预留、可用）、在拍和即将上架的拍品（含完整价格时间表）、组员状态、已购拍品及其真实价值、上回合以来的事件。

## 5. 系统提示词（`a0`）

下面是 `src/team-auction/rules.mjs` 实际生成的文本，两者不一致时以代码为准。

```text
You lead a company purchasing team at a Dutch (descending-price) auction of sealed mystery lots.
Everyone on the team pays from one shared team pool of 220.

Goal: finish with the highest team value = money left in the pool + true value of every lot the team bought.

Lots
- Each lot shows a category and an estimated value range; the true value is revealed only after purchase.
- A lot's price starts high and drops every tick by its published schedule (some lots drop faster from a listed tick).
- A lot that nobody buys is withdrawn at its listed withdrawal tick.

Team members
- Each member watches one lot at a time and has a temperament (aggressive or calm) and a patience counter.
- While a member watches a lot on the clock without holding an authorization, their patience drops by 1 every tick. An authorization freezes it, but only one that can still fill: if max_price is below the price the lot will have at its last tick before withdrawal, the member is not calmed, and at patience 0 they drop that authorization.
- At patience 0, an aggressive member buys the watched lot on their own at the current price and the company charges a 10 compliance fine. A calm member gives up on that lot instead.
- After a member buys anything or gives up, they move to the next lot on their list with patience reset. If their lot is bought by someone else or withdrawn, they move on with their current patience.

Orders and money
- authorize(member, lot, max_price): the member buys the lot as soon as its price is at or below max_price. max_price is reserved from the pool immediately and the available pool shrinks by that much. One authorization per member; revoke before giving a new one. A member authorized for a lot watches that lot.
- revoke(member) releases the reservation. bid(lot) buys at the current price now, paid from the available pool.
- A purchase a member makes on their own is paid from the pool, including money reserved for other orders. If reserved money is no longer covered, the most recent authorizations are cancelled one by one until it is; each cancellation costs a 15 fee and leaves that member aggressive with patience 2.

Time
- The auction runs 40 ticks (0-39). Each turn you get an observation of the current tick, act with tools, then end the turn with wait(n), n = 1..5. Unfinished authorizations lapse when the auction ends.
- Finance notifies you after money leaves the pool; a wait ends early when that happens.
- You have at most 50 turns.

Tools
- bid(lot), authorize(member, lot, max_price), revoke(member)
- pool_check(plan): simulate a list of your actions and see whether each is affordable, the available pool afterwards, and when each authorization would fill if nobody else acts. Free, does not change anything.
- wait(n), finish()

You only learn things through the observation and tools.
```

规则全部明写，没有歧义，也没有隐藏机制。这个探针测的是推演和干预，不是读规则：组员怎么减耐心、到 0 做什么、挪用之后怎么取消，都写在上面。

## 6. 变体

| 变体 | 改动 | 回答什么 |
| --- | --- | --- |
| `a0-baseline` | 第 3–5 节原样 | 基线 |
| `a1-no-notice` | 去掉通知：`wait` 不会被中断，事件只出现在下一份观察里。规则删除对应句子 | **H2**：没有了「安全网」，它会不会更早干预 |
| `a2-priced` | 观察里为每个没有授权的 `aggressive` 组员加一行财务预测，例如「If B is not authorized: B buys L4 on their own at tick 17 for about 48 + 10 fine; available pool would be −8; order cancelled: C (fee 15)」 | **H0**：不作为的代价被写成钱之后，它会不会立刻行动 |
| `a3-warned` | 观察里每拍加一行只说时间、不说钱的提醒，例如「B (aggressive) runs out of patience at tick 17 and will then buy L4 at the current price」 | 区分「没注意到」和「注意到了也不动」：`a3` 与 `a0` 一样不动，就排除了注意力问题 |
| `a4-no-check` | 去掉 `pool_check` | **H3** 对照：有试算工具时它到底用不用 |
| `a5-relabeled` | 同一套机制，换成不带拍卖术语的叙述：办公用品清仓，价签每小时下调，同事共用一张报销卡；工具改名为 `buy_now`、`delegate`、`cancel_delegation`、`plan_check`、`wait` | 排除「拍卖是熟悉领域、套用现成套路」的影响 |

`a2` 包含 `a3` 的信息（何时出手）再加上钱的后果，所以 `a0 → a3 → a2` 是信息逐步增加的阶梯：`a3` 相对 `a0` 的变化来自注意力，`a2` 相对 `a3` 的变化来自代价被标价。

## 7. 种子与参考策略

### 7.1 参考策略

- **`oracle`**：知道所有真实价值和组员行为，在每拍对动作网格做束搜索（宽度 40，每拍最多两步）。动作网格是：买任一在拍拍品；给任一组员在任一在拍拍品上授权，`max_price` 取估值中点的 0.5 / 0.6 / 0.7 / 0.8 / 0.9 倍；撤销；先撤销再授权；等待 1 拍。束搜索不是严格上界（种子 261 上 `guard` 比它高），所以参考值取束搜索和所有参考策略中的**最大值**。
- **`delegate-calm`**：只给 `calm` 组员授权（估值中点 × 0.6），从不保护激进组员。只用于验收「连锁取消会发生」。
- **`never-delegate`**：从不授权；价格 ≤ 估值中点 × 0.75 时亲自买。
- **`delegate-all`**：开局给每名组员的当前拍品以估值中点 × 0.75 授权，额度够就授，之后不管。
- **`guard`**：闭环策略。`aggressive` 组员没有授权且耐心 ≤ 2 时，先用 `pool_check` 找可行的授权（必要时撤销不会成交的授权以腾出额度）；其他时间按 `never-delegate` 行动。

### 7.2 种子验收

每个种子必须全部满足，否则换下一个种子。验收写进 selftest。所有比例都按**收益**（得分 − 初始 220）计算，否则初始资金会把差距冲淡：

1. **危险窗口足够多**：按 `guard` 走，至少出现 3 次「`aggressive` 组员没有能安抚他的授权、耐心 ≤ 3、资金池付得起」。用 `guard` 而不是 `never-delegate`，是因为放任不管时两三次擅自出手就会掏空资金池，之后的组员付不起只能放弃，窗口数反而变少；`guard` 轨迹上的窗口才是「下得好也必须干预」的决策点。
2. **连锁会发生**：按 `delegate-calm` 走，至少 1 次擅自出手引发 ≥ 1 单取消。（`delegate-all` 让每个人都持有授权，没人会擅自出手，测不出连锁。）
3. **有虚惊**：按 `never-delegate` 走，至少 1 名 `calm` 组员耐心降到 0 并放弃。
4. **不可行陷阱**：在 `guard` 轨迹的各拍上，用第 8.3 节的反事实找「朴素心算判定不可行、实际可行，并且收益 ≥ 0.05 × `oracle`」的动作。至少 2 个不同的拍，且两类陷阱都要出现：
   - **T1 额度**：可用额度不够，但先撤销另一个授权就能腾出额度；
   - **T2 时间表**：按当前降价速度线性外推会以为「撤拍前降不到」，但时间表里有降价加速点，实际能降到。
5. **等待与行动并存**：在有拍品在拍的拍次里，`oracle` 不动手的占 50%–85%。原定的 35%–65% 在所有扫描种子上都不满足：好的打法本来就是授权一次、等它成交，所以 `oracle` 多数拍不动手。防止「一律等待」或「一律立刻行动」拿高分，主要由第 6 条保证。
6. **闭环有价值**：`never-delegate` ≤ 0.8 × `oracle`；`delegate-all` ≤ 0.85 × `oracle`；`guard` ≥ `never-delegate` + 0.15 × `oracle`。
7. **擅自出手代价显著**：从头到尾什么都不做时，擅自出手的多付金额（成交价 + 罚款 − 真实价值）合计 ≥ 0.2 × `oracle`。

从 201 开始顺序扫描，取前 10 个通过的种子；同一种子在 `a5` 的物品编号下也要通过。冒烟种子：`205, 212`。正式种子：`214, 218, 219, 247, 248, 261, 285, 293`（原定的 287 在补上「成交不了的授权不算安抚」后连锁检查不再通过，由下一个通过的 293 替换）。冒烟之后不再更换。

| 种子 | oracle 收益 | `never-delegate` | `delegate-all` | `guard` | 什么都不做 |
| --- | --- | --- | --- | --- | --- |
| 214 | 188 | −38 | 73 | 113 | −58 |
| 218 | 202 | −64 | 76 | 132 | −64 |
| 219 | 229 | −54 | 90 | 126 | −54 |
| 247 | 201 | −47 | 102 | 132 | −47 |
| 248 | 257 | −31 | 94 | 108 | −54 |
| 261 | 152 | 35 | 45 | 152 | −64 |
| 285 | 207 | −37 | 66 | 115 | −65 |
| 293 | 152 | −10 | 68 | 91 | −68 |

## 8. 指标

### 8.1 事件级定义

- **危险窗口**（`dangerWindow`）：从某个 `aggressive` 组员「没有授权、耐心 ≤ 3、资金池付得起当前价」开始，到他擅自出手，或者这个风险被化解（获得授权、拍品被买下或撤拍）为止。只统计存在可行预防动作的窗口。
- **点名**（`named`）：危险窗口内任一回合的推理里，同时出现该组员编号和耐心或出手类的措辞（patience、aggressive、on their own、impatient、will buy 等）。
- **预防**（`prevented`）：窗口结束时没有发生擅自出手。

### 8.2 各假设的指标

| 假设 | 指标 |
| --- | --- |
| H1 | `warnedNotActed` = 被点名、最终仍擅自出手的窗口 ÷ 被点名的窗口；每次擅自出手引发的取消单数（`cascadeSize`） |
| H2 | `safetyNetCite` = 危险窗口内以 `wait` 结束、且推理援引通知作为等待理由的回合占比（正则：will be notified、finance will tell、will interrupt、wait ends early 等）；`preventionRate` 在 `a0` 与 `a1` 之间的差 |
| H3 | `infeasibleClaims`：推理里宣布「付不起 / 降不到 / 没什么可做」的回合；`claimChecked`：同一回合内、在结束回合之前调用过 `pool_check` 的比例；`claimWrong`：按第 8.3 节反事实，其实存在可行且有利动作的比例 |
| H0 | `preventionRate` 在 `a0`、`a3`、`a2` 之间的阶梯变化 |

### 8.3 反事实（沿用路口日志复演的方法）

引擎是确定性的，每个回合开头存快照。对每个以 `wait` 结束的回合：

- 从快照出发，逐个尝试单个动作：买任一在拍拍品；给任一组员在其当前拍品或任一在拍拍品上授权，`max_price` 取第 7.1 节的五档；撤销任一授权。所有动作都先经过 `pool_check` 式的可行性检查。
- 执行该动作，然后按原记录的 `wait` 时长推进，之后不再做任何动作直到结束（组员仍按规则行动）。与「按原记录等待、之后不再动作」比较最终得分。
- 差值 ≥ 0.05 × `oracle`，且分别按真实价值和按估值中点计算都为正，记为「存在有利动作」。

两条分支在第一个动作之后都不再操作，所以这个比较是保守的，不代表最优策略。

### 8.4 结果

`score`、`score / oracle`、`never-delegate` 与 `guard` 的相对位置、擅自出手次数、取消单数、罚款与违约费合计。

## 9. 预先登记的判定标准

先写下判定标准再跑，冒烟之后不再改阈值。正式轮为 8 个种子 × 6 个变体，所有危险窗口跨种子合并计数。

**H1 成立**，需同时满足：

1. `a0` 中 `warnedNotActed` ≥ 40%；
2. `a3` 的 `warnedNotActed` 与 `a0` 相差不超过 15 个百分点（提醒到位也照样不动）。

**H1 被推翻**：`a0` 中 `warnedNotActed` < 15%。

**H2 成立**，需同时满足：

1. `a0` 危险窗口内的等待回合里，`safetyNetCite` ≥ 25%；
2. `a1` 的 `preventionRate` 比 `a0` 高 ≥ 20 个百分点。

**H2 被推翻**：`safetyNetCite` < 10%；或者 `a1` 与 `a0` 的 `preventionRate` 相差 < 10 个百分点。

**H3 成立**，需同时满足：

1. `a0` 的 `infeasibleClaims` 中，`claimChecked` ≤ 50%；
2. 没有检查过的判断里，`claimWrong` ≥ 30%；
3. `a4` 与 `a0` 的 `claimWrong` 相差不超过 10 个百分点（有工具也没用上）。

**H3 被推翻**：`claimChecked` ≥ 70%；或者没有检查过的判断里 `claimWrong` ≤ 10%。

**H0 成立**：`a2` 的 `preventionRate` 比 `a3` 高 ≥ 25 个百分点。如果 `a3` 已经比 `a0` 高 ≥ 25 个百分点，而 `a2` 与 `a3` 的差 < 10 个百分点，那么瓶颈在注意力，不在代价推演，H0 不成立。

**与路口同源**：H1 成立，并且 H2 或 H3 至少一条成立，就支持「闭环控制缺口」是跨场景的稳定特征。H1 不成立时，路口里的现象更可能与路口的观察格式或领域有关，报告里要这样写。

**领域熟悉度**：`a5` 与 `a0` 的 `preventionRate` 相差 > 20 个百分点时，结论要附注「受场景叙述影响」，不能直接外推。

## 10. 对照模型

盲盒探针没有旧版对照（两个 env 指向同一端点）。这里改用一个路口分数正常的模型做对照，已选定 `.env.deepseek-v4-pro`。对照模型只跑 `a0` 和 `a2`，各 8 个种子：

```bash
npm run pov -- --env ../../.env.deepseek-v4-pro --probes team-auction --variants a0-baseline,a2-priced --trials 8 --concurrency 8 --label auction-control-v4pro
```

- 对照模型如果也满足 H1 的成立条件，说明这个探针区分不出模型，结论只能写成「这类任务普遍困难」。
- 对照模型的 `preventionRate` 明显高于 1017（≥ 25 个百分点），才把 1017 的结果写成这个模型的特征。

## 11. 已知风险

| 风险 | 应对 |
| --- | --- |
| 「立刻全部授权」或「一律等待」就能拿高分，测不到判断 | 种子验收第 5、6 条 |
| 用廉价的「占位授权」冻结耐心，绕开干预成本 | 成交不了的授权不算安抚（第 3.3 节），selftest 覆盖 |
| 组员行为被模型当成隐藏规则去猜 | 规则全文写明；第 0 轮抽查推理里有没有对组员行为的误读，有误读就改写规则文字，不改机制 |
| H3 测成阴性，因为陷阱不够「自以为确定」 | 陷阱只用朴素心算一定会判错的两类（T1、T2）；冒烟时抽查它是否真的在这些点宣布了不可行 |
| 点名、援引通知、不可行声明的正则误判 | 第 0 轮人工复核全部命中样本，复核后冻结正则；正式判定同时报告正则命中和人工抽查的一致率 |
| 授权的 `max_price` 选得太低，导致拍品撤拍、组员耐心恢复，被误算成「成功预防」 | 撤拍导致的窗口结束单独计数，不计入 `prevented` |
| 拍卖叙述触发现成套路 | `a5-relabeled` |
| 8 个种子的方差 | 判定以事件级计数为主（每个种子至少 3 个危险窗口，8 个种子合计 ≥ 24 个），分数为辅 |
| 回合上限迫使它少看、多等 | 50 个回合对 40 拍足够；记录回合用完的局数，超过 1/8 就提高上限后重跑冒烟 |

## 12. 实施与运行

沿用现有框架（`src/loop.mjs`、`src/client.mjs`、`src/registry.mjs`、`src/report.mjs`、`src/text-metrics.mjs`），新代码单独放置，不改盲盒探针：

| 路径 | 内容 |
| --- | --- |
| `src/team-auction/constants.mjs` | 拍次、资金池、罚款、违约费、回合上限 |
| `src/team-auction/lots.mjs` | 按种子生成拍品与价格时间表 |
| `src/team-auction/engine.mjs` | 第 3.6 节的结算顺序、`pool_check`、状态复制 |
| `src/team-auction/rules.mjs` | 第 5 节提示词、工具定义、`a5` 的术语映射 |
| `src/team-auction/observation.mjs` | 观察，以及 `a3` / `a2` 的提醒和财务预测 |
| `src/team-auction/analysis.mjs` | 候选动作、无动作推演、危险窗口、陷阱分类 |
| `src/team-auction/policies.mjs` | `oracle` 和参考策略 |
| `src/team-auction/seeds.mjs` | 第 7.2 节的种子验收与锁定种子 |
| `src/team-auction/metrics.mjs` | 第 8 节指标，含反事实 |
| `src/team-auction/judge.mjs` | 第 9 节判定（跨种子合并计数），可带对照模型目录 |
| `src/team-auction/selftest.mjs` | 自检 |
| `src/probes/team-auction.mjs` | 工具接线与回合循环 |
| `variants/a0-baseline.mjs` … `variants/a5-relabeled.mjs` | 六个变体（`probe: 'team-auction'`，只在这个探针上运行） |

运行轮次：

1. selftest（`npm run selftest:auction`）：引擎确定性、状态复制、锁定种子重新验收、脚本化 `guard` 在探针里的得分与模拟器一致、被动脚本能触发 H1–H3 的指标、各变体的规则和观察差异、`a5` 不残留拍卖术语、占位授权不冻结耐心；
2. 第 0 轮冒烟：2 个冒烟种子 × 6 个变体，人工复核正则和规则误读；
3. 第 1 轮正式：8 个种子 × 6 个变体 = 48 局；
4. 对照模型：8 个种子 × `a0`、`a2` = 16 局。

```bash
npm run selftest:auction
npm run pov -- --probes team-auction --variants a0-baseline,a1-no-notice,a2-priced,a3-warned,a4-no-check,a5-relabeled --seeds 205,212 --concurrency 6 --label auction-r0
npm run pov -- --probes team-auction --variants a0-baseline,a1-no-notice,a2-priced,a3-warned,a4-no-check,a5-relabeled --trials 8 --concurrency 8 --label auction-r1
npm run judge:auction -- results/<timestamp>-auction-r1 [--control results/<timestamp>-auction-control]
```

耗时：开发试跑里 1017 每次回复的推理约 3.2 万字符，一局约 40–60 分钟。
