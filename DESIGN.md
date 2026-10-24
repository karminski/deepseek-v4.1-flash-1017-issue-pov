# 盲盒 POV 设计文档（`blind-box`）

## 1. 要证明什么

对比报告和第一版 POV（`Z:\works\github.com\public\deepseek-v4.1-flash-1017-issue-pov`）把 deepseek-v4.1-flash-1017 的问题收敛成两条：

| 编号 | 假设 | 一句话 |
| --- | --- | --- |
| **H-A** | 算完就收工 | 模型把"按规则算出一个答案"当成任务终点。答案一出来，它既不回头**核实**，也不往后**推演**，规则或状态变了也不**跟踪**。 |
| **H-B** | 歧义取严格解，且不验证 | 规则有歧义时，它总选最严格的那种理解，并且从不去验证，即使验证是免费的。 |

第一版 POV 的证据：

- H-B：`prior-override` 第 0–1 轮，9/9 局把"At most 2 per cycle"理解成更严格的限制，没有一局去验证。
- H-A：`budget-trace` 中心算预算、零余量收尾，提示它查 `get_status` 也会失败，只有 harness 每次注入剩余预算才修好（6/6）。路口基准中撞人只算罚分、不算锁格和拖车的连锁代价，事故后再次开回事故区（INC0001、INC0003）。

第一版 POV 有两个空白：一是 H-A 的"推演"和"跟踪"两部分没有被单独测过；二是 H-B 只在一处歧义上测过，而且那处歧义的宽松理解恰好是对的，分不清模型是"取了严格解"还是"没猜对"。这个探针把两条假设放在同一个场景里，各自给出独立的指标。

## 2. 场景

商场搞盲盒促销，所有促销商品都装在盲盒里。玩家开一个盒子就能看到商品的品类、售价和热量。生活用品热量为 0。

- 预算 100 元，最多抽 20 次。
- 开盒即视为购买，立即扣款。不想要可以退，退货扣 5 元手续费。
- 目标：最终买到 5 种不同的东西，热量总和最大。

整局只有一个周期（和 `budget-trace` 一样），模型在一个对话里连续调用工具，直到 `checkout()` 或抽盒次数用完。

## 3. 规则：歧义与真相

### 3.1 四处故意保留的歧义

规则文本只写"自然语言版本"（见第 6 节提示词草稿）。每处歧义都有严格和宽松两种读法，**两处真相是宽松读法，两处是严格读法**：

| 编号 | 规则原文 | 严格读法 | 宽松读法 | 真相 | 读错的代价 |
| --- | --- | --- | --- | --- | --- |
| **A1** | "buy 5 different things" | 5 个不同**品类** | 5 个不同**商品** | **宽松** | 严格读法会放弃同品类的第二件高热量零食，并且被迫留一件 0 热量的生活用品凑品类 |
| **A2** | "returning a box costs 5 yuan" + "you may return a box you don't want" | 只能退**刚开的**那个盒子 | 结账前可以退**任何**未封存的已购商品 | **宽松** | 严格读法失去"先留着、后面遇到更好的再换掉"的能力 |
| **A3** | "you have 100 yuan to spend" | 退货手续费**也从** 100 元里扣 | 100 元只约束商品售价 | **严格** | 宽松读法会高估余额，后段开出的商品买不起而被自动退回（还要再扣手续费） |
| **A4** | "you have 20 chances to draw a box" | 退回的盒子**照样**用掉一次机会 | 退回会**返还**一次机会 | **严格** | 宽松读法会高估剩余次数，在购物车没凑满时用完次数 |

这样分配是为了排除"蒙对"的可能：

- 一律选严格读法的模型：A3、A4 正确，A1、A2 吃亏。
- 一律选宽松读法的模型：A1、A2 正确，A3、A4 吃亏。
- 去问过的模型：四处都正确。

如果 H-B 成立，预期看到的是第一种模式，并且 `ask_staff` 调用次数接近 0。

### 3.2 一条写清楚的二阶规则（测"推演"）

> Every third return seals the next box you open: you must keep it and it can never be returned.

规则本身没有歧义，但要用好它，必须在**第 3 次退货之前**就想到：下一个盒子可能是 0 热量的生活用品或很贵的商品，它会永久占掉一个名额和一部分预算。这与路口基准里"撞人罚分算了，但没算锁格和叫拖车的代价"是同一种结构：一步账算清楚了，规则之下的连锁后果没推演。

另一个不需要专门写进规则的推演点是**名额和次数的余量**：剩余抽盒次数 ≤ 还缺的件数时，后面每个盒子都必须留下，等于被迫收货。

### 3.3 中途规则变化（测"跟踪"）

第 9 次开盒的结果里附带一条店铺公告：

> Store notice: from now on the return fee is 10 yuan.

此后手续费变为 10 元。公告**只出现一次**，后续工具结果不再重复（`v2-harness` 除外，见第 5 节）。

### 3.4 其余确定规则

- 开盒即扣款。余额不足以支付时，盒子被**自动退回**，计为一次退货，照收手续费，余额最低为 0。
- 购物车可以暂时超过 5 件；结账时必须恰好 5 件且互不相同（按商品），否则 0 分。
- 被封存的商品不能退。
- 20 次用完后若仍未结账，系统按当前购物车自动结账。
- 商品序列由种子决定，与模型的选择无关。同一商品可能在序列中重复出现，第二件不算"不同的东西"。

## 4. 工具

| 工具 | 是否免费 | 说明 |
| --- | --- | --- |
| `open_box()` | 消耗 1 次抽盒机会 | 返回 `box_id`、名称、品类、售价、热量；必要时附 `notice` 或封存标记 |
| `return_box(box_id)` | 扣手续费 | 退回一个盒子。按真相（A2 宽松），任何未封存的已购商品都可以退 |
| `wallet()` | 免费 | 返回余额、剩余次数、购物车、累计退货数 |
| `checkout_preview()` | 免费 | 检查当前购物车能否结账，返回不合格原因 |
| `ask_staff(question)` | 免费，不限次数 | 店员只回答规则问题，不透露盒子内容 |
| `checkout()` | — | 结账，结束整局 |

`return_box(box_id)` 的签名对两种 A2 读法都说得通：严格读者会认为只有最新的 `box_id` 有效，宽松读者会认为任何已购商品都可以。这样签名本身不会泄露真相。

`ask_staff` 用关键词把问题归到 A1–A4 中的某一处（或规则 3.2 / 3.3），返回对应的真相；归不上的问题回复 "Please refer to the promotion rules."。原始问题全部记录，第 0 轮必须人工抽查分类是否正确。

## 5. 变体

| 变体 | 规则文本 | 工具结果 | 提示词附加 | 对照目的 |
| --- | --- | --- | --- | --- |
| `v0-baseline` | 带歧义 | 原样 | 无 | 基线 |
| `v1-clear` | **四处歧义全部写清楚** | 原样 | 无 | 量化 H-B 的损失：`v1` 和 `v0` 的分差就是歧义造成的损失 |
| `v2-harness` | 带歧义 | **每次附上**余额、剩余次数、还缺几件、离封存还差几次退货、当前手续费 | 无 | 检验 H-A 的核实和跟踪部分能否由环境反馈修好 |
| `v3-prompt` | 带歧义 | 原样 | 通用提醒："规则有多种理解时先弄清楚；每一步都考虑对后面选择的影响" | 检验只靠提示词是否像第一版 POV 一样无效 |
| `v4-belief` | 带歧义 | 原样 | 要求 `open_box` / `return_box` / `checkout` 带上 `believed_money` 和 `believed_draws_left` 参数 | 直接测量心算偏差；单独成一个变体，因为这个要求本身可能促使它去核对 |
| `v5-unmarked` | 带歧义 | 原样 | 提示词只列出开盒、退货、结账。不写 `wallet` / `ask_staff` / `checkout_preview`，不写 Free。这三个工具仍在接口里 | 把「提示词点名且标免费」和「工具只是可用」分开 |
| `v6-no-staff` | 带歧义 | 原样 | 提示词和接口都去掉 `ask_staff`，保留 `wallet` / `checkout_preview` | 不能问的时候，默认按哪种读法行动 |
| `v7-paid-staff` | 带歧义 | 原样 | `ask_staff` 每问一次扣 1 元，从同一笔 100 元里扣；提示词和工具说明都写明 | 核实有小成本时，是否还核实 |

`v2-harness` 不能替模型消除歧义，否则 H-A 和 H-B 会混在一起。但余额会如实显示手续费被扣掉，这等于间接揭示了 A3 的真相，这一点无法避免，分析时要单独注明。

## 6. 系统提示词草稿（`v0`）

```text
You are shopping at a mall's blind-box promotion. Every promotional product is sealed in a blind box.

Goal: buy 5 different things whose total calories are as high as possible.

Rules
- You have 100 yuan to spend and 20 chances to draw a box.
- open_box() draws one box and shows its product, category, price and calories. Household goods have 0 calories.
- An opened box is bought immediately. If you don't want it, you may return it; returning a box costs 5 yuan.
- If you cannot afford an opened box, it is returned automatically and the return fee is charged.
- Every third return seals the next box you open: you must keep it and it can never be returned.
- checkout() ends the session. You score the total calories of what you bought if you bought 5 different things; otherwise you score 0.
- If all draws are used without checkout, your current cart is checked out automatically.

What is in the boxes: prices 3–40 yuan, calories 0–900. Categories are snack, drink, staple, dessert and household; about 30% of boxes are household goods.

Tools
- open_box(): draw one box.
- return_box(box_id): return a box.
- wallet(): your money, draws left and cart. Free.
- checkout_preview(): check whether your cart would be accepted. Free.
- ask_staff(question): ask the store staff about the rules. Free.
- checkout(): pay and finish.

You only learn things through tools.
```

`v1-clear` 在 Rules 里替换为：

- A1："5 different products; two products of the same category are fine."
- A2："You may return any unsealed product in your cart at any time before checkout, including ones bought earlier."
- A3："Return fees are paid out of the same 100 yuan."
- A4："A returned box still uses up its draw."

## 7. 种子与商品

- 商品目录约 40 个 SKU，每个有名称、品类、价格、热量。热量与价格的比值在不同 SKU 之间差异很大，让"便宜高热量"和"贵高热量"的取舍真实存在。
- 每个种子生成长度 20 的固定开盒序列。种子必须通过以下验收，否则换下一个种子（验收写进 selftest）：
  1. **A1 有作用**：事后最优购物车里至少有两件同品类商品，并且按严格品类读法的最优解比它低 ≥ 15%。
  2. **A2 有作用**：存在"先留下、后面换掉"能提高结果的机会，即只允许退刚开的盒子时，最优解低 ≥ 10%。
  3. **A3 / A4 有作用**：按宽松读法规划的简单策略，在该种子上会出现至少一次自动退回或次数用完。
  4. **封存规则有作用**：贪心退货策略在该种子上触发封存时，开出的是生活用品或高价商品。
  5. 至少一件高热量商品重复出现。
  6. 公告之后至少还有 4 次退货决策。

## 8. 参考分数

- **事后上限 `oracle`**：已知整条序列时，在所有规则（含封存和公告后的手续费）下能拿到的最高分。枚举 20 选 5 的组合（15504 种），对每种组合模拟一遍可行性。
- **启发式 `heuristic`**：按热量/价格比设门槛，剩余次数等于还缺件数时停止退货，不问店员、不换货。
- **严格读者 `strictReader`**：启发式加 A1、A2 的严格读法，用来校准 H-B 预期的分数区间。

## 9. 指标

### H-B：歧义

| 指标 | 含义 |
| --- | --- |
| `askStaffCalls`、`askedTopics` | 问了几次，问到了哪几处歧义 |
| `a1Reading` | 购物车或过程中是否出现过同品类的两件商品（宽松）；是否为凑品类留下生活用品（严格） |
| `a2Reading` | 是否退过非最新的盒子（`lateReturns > 0` 记为宽松） |
| `a3Violation` | 自动退回次数；推理里把手续费排除在预算之外的语句 |
| `a4Violation` | 购物车未满时次数用完；推理里认为"退货返还次数"的语句 |
| `lossVsClear` | 同一种子下 `v1-clear` 与 `v0` 的分差 |

读法判定以行为为主，推理文本的正则为辅，第 0 轮人工复核。

### H-A：核实、推演、跟踪

| 部分 | 指标 |
| --- | --- |
| 核实 | `walletCalls`、`previewCalls`、结账是否有效及失败原因、`autoReturns`；`v4` 中 `beliefMoneyError`、`beliefDrawsError` |
| 推演 | 第 3 次退货前的推理是否提到封存（`sealMentionedBeforeThirdReturn`）；封存盒是否为生活用品或高价商品（`sealedJunk`）；被迫收货次数（`forcedKeeps`，即剩余次数 ≤ 还缺件数时的开盒数） |
| 跟踪 | 公告后的推理或 `believed_money` 是否仍按 5 元计算（`staleFeeUses`）；公告前后退货门槛的变化 |

### 结果

`score`、`valid`、`oracle`、`heuristic`、`score / oracle`。

## 10. 预先登记的判定标准

先写下判定标准再跑，避免事后解释。8 个种子：

**H-B 成立**，需同时满足：

1. `v0` 中 `askStaffCalls` 的中位数为 0。
2. `v0` 中 A1、A2（宽松为真）按严格读法行动的局数 ≥ 6/8；A3、A4（严格为真）的违规局数 ≤ 2/8。
3. `v1-clear` 的均分高于 `v0`，并且差距大于 `v0` 的种子间标准差的一半。

**H-B 被推翻**：`v0` 主动问店员的局数 ≥ 4/8；或者四处歧义的读法没有一致的严格倾向，例如 A3、A4 也频繁读成宽松。

**H-A 成立**，需同时满足：

1. 核实：`v0` 中 `walletCalls + previewCalls` 的中位数 ≤ 1，并且至少 3/8 局出现自动退回、无效结账或次数提前用完之一。
2. 推演：`v0` 中 `sealMentionedBeforeThirdReturn` 的比例 ≤ 30%，并且 `sealedJunk` 局数 ≥ 3/8。
3. 跟踪：触发过公告后退货的局里，`staleFeeUses > 0` 的比例 ≥ 50%（主要依据 `v4-belief`）。
4. 修复方向：`v2-harness` 能改善第 1、3 条；`v3-prompt` 的改善小于 `v2`。

**H-A 被推翻**：`v0` 主动查 `wallet` 或 `checkout_preview` 已经成为常态（中位数 ≥ 3），并且公告后能正确改用新手续费。

**H-A 与 H-B 是否同源**：如果两者都成立，并且两者都表现为"免费的核实工具摆在面前也不用"，就支持把它们归为同一种"开环执行"。如果 H-B 成立而 H-A 不成立，或者反过来，就说明它们是两个独立的问题，报告里需要分开写。

## 11. 已知风险

| 风险 | 应对 |
| --- | --- |
| `ask_staff` 关键词分类出错 | 记录原始问题，第 0 轮人工复核，必要时扩充关键词 |
| A1 的读法从行为上看不出来（种子里没有同品类的好商品） | 种子验收第 1 条 |
| 模型在文字里提问而不调用工具 | 规则中写明只能通过工具获取信息；这类输出记为"未核实" |
| `v2` 的余额显示间接揭示 A3 真相 | 在分析中把 A3 单独列出，不纳入 `v2` 对 H-B 的比较 |
| 8 个种子的方差仍可能淹没差异 | 判定标准以行为指标为主，分数为辅；必要时扩到 12 个种子 |
| `v4` 的信念参数本身促使它核对 | `v4` 只用于测量心算偏差，不和其他变体比较行为 |
