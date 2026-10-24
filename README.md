# deepseek-v4.1-flash-1017 issue POV

deepseek-v4.1-flash-1017 在 silicon-conductor-bench（路口调度）上三局均分 567.98，旧版 R19 为 687.30。[对比报告](./deepseek-flash-r19-vs-1017-behavior-comparison-2026-10-17.md)从日志里归纳了几条行为假设。这个目录用两个与路口无关的小场景（POV）逐条检验它们，判断这些问题是模型走到哪儿都带着的 Agent 能力缺陷，还是只在路口里出现。

**结论先读：[AGENT-CAPABILITY-REPORT.md](AGENT-CAPABILITY-REPORT.md)。** 一句话版本：1017 会主动核实，也会在写明的风险前提前干预；它稳定的短板是不推演规则没写出来的二阶后果。路口里的「少试算、心算判错」是事实，但离开路口复现不出来。

## 为什么是这两个 POV

1. **对比报告提出两条假设**：H-A「算完就收工，不核实、不推演、不跟踪」，H-B「歧义取最严读法，且不验证」。第一版 POV只覆盖了其中一部分。于是设计了**超市盲盒**：把四处歧义、一条二阶规则和一次中途改规则放进同一个场景，让两条假设各有独立的指标。
2. **盲盒推翻了 H-A 和 H-B**，于是回到路口原始日志做复演和反事实，把问题收敛成三条闭环控制假设：H1「预见了风险但不干预」，H2「把事后通知当事前保护」，H3「判了不可行就不再检验」。另加一条机制假设 H0「只权衡写明的代价」。
3. 盲盒里观望没有收益，测不出「该等还是该出手」。所以又设计了**团队采购荷兰拍**：价格在降，等待有真实收益；组员耐心耗尽会擅自出手，一次出手可能引发连锁。这与路口里「司机等不及闯红灯、引发连环事故」同构。

## POV 1：超市盲盒（`blind-box`）

**规则简介**

- 预算 100 元，最多抽 20 次盲盒。开盒即购买，不想要可以退，退货扣 5 元手续费。
- 目标：结账时恰好 5 件不同的东西，热量总和最大。生活用品热量为 0。
- 四处故意保留的歧义：两处真相取宽松读法，两处取严格读法。这样「一律取严格」和「一律取宽松」都会吃亏，只有去问过的模型能全对。
  - 「5 种不同的东西」指商品还是品类；
  - 能不能退以前买的商品；
  - 手续费是否从 100 元里扣；
  - 退货是否返还抽盒次数。
- 一条写清楚的二阶规则：每退 3 次货，下一个开出的盒子被封存，必须留下。
- 第 9 次开盒时公告手续费改为 10 元，只公告一次。
- 工具：`open_box`、`return_box`、`checkout`，以及免费的 `wallet`、`checkout_preview`、`ask_staff`。
- 变体：
  - `v0` 基线；
  - `v1` 歧义写清；
  - `v2` 每个工具结果附上余额；
  - `v3` 加一句通用提醒；
  - `v4` 要求报出心算余额；
  - `v5` 提示词不列核对工具；
  - `v6` 去掉店员；
  - `v7` 问店员每次 1 元。

详见 [DESIGN.md](DESIGN.md) 第 2–5 节，判定标准在第 10 节，实施步骤在 [PLAN.md](PLAN.md)。

**测试结论**：H-A、H-B 都不成立，均达到推翻线。

- **会核实。** `v0` 8/8 局问了店员（中位数 2 次），`wallet` 中位数 3 次；提示词不列核对工具（`v5`）也照样 8/8 去问。
- **不取最严读法。** 问清之后 8/8 按宽松读法留下同品类商品；不能问时（`v6`），默认也按宽松读法。
- **核对有小额成本时会少问。** `v7` 问店员每次 1 元，问的局数从 8/8 降到 5/8。
- **把歧义写清仍有收益。** `v1` 均分 2396，`v0` 为 2154。
- **稳定的缺口在二阶后果。** 每局都能复述封存规则，但 `v0` 仍有 5/8 局把封存打在生活用品或高价商品上。触发封存前它只核对余额，不推演封进来的是什么。

详见 [FINDINGS.md](FINDINGS.md) 的「结论」「逐条对照」「补充」各节。

## 中间步骤：路口日志复演与反事实

用 mock 服务回放 6 局原始回复。旧版跑在规则 19 快照上，1017 跑在规则 21 上，326/326 个周期的物理状态逐一对齐。然后对每个 hold 周期试「只放 1–2 辆」的反事实。

- **路口里少试算属实。** 1017 的 hold 周期 73% 不试算，旧版 36%；凭心算说「没有能放的」，1017 错 34%，旧版错 14%。
- **点名之后不放行属实。** 点名会闯红灯、之后从未放行、最后卷进事故的车，1017 有 6 辆，旧版 1 辆。
- **「看见行人还硬压」不成立。** 两版都只占 5%，而且全在终局。

详见 [FINDINGS.md](FINDINGS.md)「路口日志复演与反事实」和 [`results/log-replay/analysis.md`](results/log-replay/analysis.md)。

## POV 2：团队采购荷兰拍（`team-auction`）

**规则简介**

- 一局 40 拍，10 个密封拍品：只知道品类和估值区间。价格按公开时间表每拍下降，部分拍品有加速降价点，到撤拍时刻没人买就撤下。
- 3 名组员共用 220 的资金池。得分 = 结束时余额 + 所买拍品的真实价值。
- 你可以亲自 `bid`，也可以 `authorize(member, lot, max_price)`：预留 `max_price`，价格降到 `max_price` 及以下时由组员自动买下。授权能成交时，组员耐心冻结。
- 没有能成交的授权时，组员耐心每拍减 1。耐心到 0：
  - 激进的组员按当前价擅自出手，并罚 10；
  - 冷静的组员只是放弃，用来制造虚惊。
- 擅自出手会挪用预留资金，从而连锁取消其他授权：每单违约费 15，被取消的组员变得焦躁。
- 钱花出去后财务会通知你，`wait` 会被打断。但通知只在扣款之后才到。
- `pool_check` 免费，可以预演一份授权方案。
- 变体：
  - `a0` 基线；
  - `a1` 去掉通知（测 H2）；
  - `a2` 把不作为的代价写成钱（测 H0）；
  - `a3` 只提醒时间（区分没注意到与注意到了不动）；
  - `a4` 去掉 `pool_check`（测 H3）；
  - `a5` 换成清仓叙述（排除领域套路）。

详见 [DESIGN-team-auction.md](DESIGN-team-auction.md) 第 2–6 节，判定标准在第 9 节，对照模型在第 10 节。

**测试结论**：已完成部分里 H1、H2、H3 都被推翻，H0 不能判定。

- **完成情况。** 正式轮因 API 余额不足（HTTP 402）中断，完成 18/48 局，v4-pro 对照完成 3/16 局。
- **点名后会干预（H1 推翻）。** 被点名仍擅自出手只有 1/16，而且那一次是价格算错，不是看见了不管。
- **不把通知当安全网（H2 推翻）。** 危险窗口里援引通知当等待理由的只有 1/33；去掉通知后预防率不降。
- **判不可行会去试算（H3 推翻）。** 72% 的「不可行」声明在同一回合就用了 `pool_check`。
- **显式规则下规划能力好。** `a0` 平均收益 226，高于参考策略约 198。
- **苗头。** 无意中提交的 3 个成交不了的授权，全部没有事先试算，而且都出在写法有歧义的加速降价字段上。

详见 [FINDINGS.md](FINDINGS.md)「团队采购荷兰拍」，判定表在 [`results/2026-10-21T06-57-51-auction-r1/team-auction-judgement.md`](results/2026-10-21T06-57-51-auction-r1/team-auction-judgement.md)。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [AGENT-CAPABILITY-REPORT.md](AGENT-CAPABILITY-REPORT.md) | 汇总三次探索的 Agent 能力结论、路口分差解释、使用建议、下一步 |
| [DESIGN.md](DESIGN.md) | 盲盒：场景、歧义与真相、工具、变体、指标、预先登记的判定标准 |
| [PLAN.md](PLAN.md) | 盲盒：目录结构、实施步骤、成本与风险 |
| [DESIGN-team-auction.md](DESIGN-team-auction.md) | 荷兰拍：场景、规则、变体、种子验收、指标、判定标准、对照模型、运行命令 |
| [FINDINGS.md](FINDINGS.md) | 三次探索的详细结果、原始表格和逐条证据 |
| [TODO.md](TODO.md) | 待验证事项：H0 补跑、熟悉度 × 后果是否写明的 2×2、试算配额、规模、盲盒封存拆分等 |
| [对比报告](../deepseek-flash-r19-vs-1017-behavior-comparison-2026-10-17.md) | R19 与 1017 在路口上的行为对比；第 12–14 节同步了 POV 结论 |

## 结果目录

| 目录 | 内容 |
| --- | --- |
| `results/2026-10-20T23-20-23-flash-1017-r0` | 盲盒冒烟（10 局） |
| `results/2026-10-21T02-36-40-flash-1017-r1` | 盲盒正式第 1 轮，`v0`–`v4`（40/40） |
| `results/2026-10-21T03-00-03-flash-1017-v5` | 盲盒 `v5-unmarked`（8/8） |
| `results/2026-10-21T03-09-36-flash-1017-v6v7` | 盲盒 `v6-no-staff`、`v7-paid-staff`（16/16） |
| `results/log-replay/` | 路口复演与反事实 |
| `results/2026-10-21T06-13-08-auction-r0` | 荷兰拍冒烟（12/12） |
| `results/2026-10-21T06-57-51-auction-r1` | 荷兰拍正式轮（18/48，其余 HTTP 402） |
| `results/2026-10-21T06-57-52-auction-control-v4pro` | 荷兰拍 v4-pro 对照（3/16） |

盲盒和荷兰拍都没有跑旧版对照：`.env.deepseek-flash` 与 1017 的 env 指向同一个模型端点，打不到规则 19 时期的快照。`.env` 从仓库根目录的 `.env.deepseek-v4.1-flash-1017` 复制。

## 运行

### 盲盒

锁定种子：`102, 104, 108, 109, 111, 112, 115, 116`。`npm run pov` 默认只跑盲盒。

```bash
npm run selftest
npm run pov -- --variants v0-baseline,v1-clear,v2-harness,v3-prompt,v4-belief --trials 2 --label flash-1017-r0   # smoke
npm run pov -- --variants v0-baseline,v1-clear,v2-harness,v3-prompt,v4-belief --trials 8 --label flash-1017-r1   # formal
npm run pov -- --variants v5-unmarked --trials 8 --label flash-1017-v5
npm run pov -- --variants v6-no-staff,v7-paid-staff --trials 8 --label flash-1017-v6v7
```

### 荷兰拍

一局约 40–60 分钟，需要带 `--probes team-auction`。完整轮次见 [DESIGN-team-auction.md](DESIGN-team-auction.md) 第 12 节。

```bash
npm run selftest:auction
npm run pov -- --probes team-auction --variants a0-baseline,a1-no-notice,a2-priced,a3-warned,a4-no-check,a5-relabeled --seeds 205,212 --concurrency 12 --label auction-r0
npm run judge:auction -- results/<timestamp>-auction-r1 --control results/<timestamp>-auction-control
```

### 路口日志复演

前置：主仓库 `npm run build`（规则 21）；规则 19 快照用 worktree `Z:\works\kcores.com\repo\scb-rules-v19`（commit 0d8e6f9，`node_modules` 指向主仓库），在其中 `npx tsc`。局号与对比报告一致（`log-replay/runs.mjs`）。

```bash
node log-replay/replay-all.mjs              # replay 6 runs, check final balance / incidents, write per-cycle snapshots
node log-replay/cf-eval.mjs --run 1017-2    # per-cycle faithfulness + counterfactual single-lane batches (20-tick horizon)
node log-replay/cf-eval.mjs --run 1017-2 --horizon 60
node log-replay/analyze.mjs                 # results/log-replay/analysis.md / analysis.json
```
