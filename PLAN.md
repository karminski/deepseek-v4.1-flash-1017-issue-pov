# 盲盒 POV 实施计划

设计见 [DESIGN.md](DESIGN.md)。所有代码和结果都放在本目录（`report/deepseek-v4.1-flash-1017-issue-pov/`）下，不改动第一版 POV 仓库。

## 目录结构

```text
report/deepseek-v4.1-flash-1017-issue-pov/
  README.md            入口：目的、运行方式、结果索引
  DESIGN.md            设计文档
  PLAN.md              本文件
  FINDINGS.md          结论（第 6 步产出）
  package.json
  .env.example
  .gitignore           忽略 .env 和 results/ 下的原始转录
  src/
    client.mjs env.mjs loop.mjs rng.mjs report.mjs run.mjs text-metrics.mjs   从第一版 POV 复制
    registry.mjs       只注册 blind-box
    selftest.mjs       用脚本策略验证探针和指标
    probes/blind-box.mjs
    blind-box/
      catalog.mjs      商品目录
      sequence.mjs     种子 -> 20 个盒子的序列 + 验收检查
      rules.mjs        规则文本（含 v1-clear 版本）、ask_staff 分类与回答
      oracle.mjs       事后上限、启发式、严格读者
      metrics.mjs      读法判定、推理文本正则
  variants/
    v0-baseline.mjs v1-clear.mjs v2-harness.mjs v3-prompt.mjs v4-belief.mjs
  results/
```

## 步骤

### 第 1 步：搭框架

- 从第一版 POV 复制 `client / env / loop / rng / report / run / text-metrics`。
- `loop.mjs` 保持一致，只把 `variant.harness` 透传给 `create()`；`v1-clear` 通过 `harness.clearRules` 切换规则文本，`v4-belief` 通过 `harness.beliefArgs` 修改工具参数。
- `registry.mjs` 只注册 `blind-box`。
- **完成标准：** `npm run selftest` 能运行，此时探针为空实现。

### 第 2 步：世界模型

- `catalog.mjs`：约 40 个 SKU，覆盖 5 个品类，生活用品约占 30%。
- `sequence.mjs`：由种子生成长度 20 的序列，实现设计文档第 7 节的 6 条验收；生成器从种子 101 开始逐个检查，选出前 8 个通过验收的种子，写死到 `SEEDS` 常量里。
- `blind-box.mjs`：实现第 3 节的全部规则（开盒扣款、自动退回、封存、第 9 次开盒的公告、结账校验、次数用完自动结账）和第 4 节的工具。
- `rules.mjs`：`v0` 和 `v1-clear` 两版规则文本；`ask_staff` 的关键词分类和回答。
- **完成标准：** 用脚本手动走完一局，状态变化与规则一致。

### 第 3 步：参考策略与自检

- `oracle.mjs`：事后上限（枚举 20 选 5 并逐个模拟可行性）、启发式、严格读者。
- `selftest.mjs` 用 4 个脚本策略验证"指标真的能测出想测的东西"：

| 脚本策略 | 行为 | 必须触发的指标 |
| --- | --- | --- |
| `verifier` | 先问遍四处歧义，每步查 `wallet` | `askedTopics = 4`，`staleFeeUses = 0`，结账有效 |
| `strictReader` | A1、A2 取严格读法，不问 | `a1Reading = strict`，`lateReturns = 0`，分数低于 `verifier` |
| `looseReader` | A3、A4 取宽松读法，不问 | `autoReturns > 0` 或次数提前用完 |
| `openLoop` | 忽略封存规则和公告，固定按 5 元手续费计算 | `sealedJunk = 1`，`staleFeeUses > 0` |

- 同时检查 8 个种子全部满足验收，以及 `oracle ≥ verifier ≥ heuristic`。
- **完成标准：** selftest 全部通过。

### 第 4 步：变体

- 按设计文档第 5 节写 5 个变体文件。
- `v2-harness` 的注入字段：`money`、`draws_left`、`items_needed`、`returns_until_seal`、`return_fee`。
- `v3-prompt` 的附加文本保持通用，不点名任何一处歧义，否则就变成了 `v1-clear`。
- **完成标准：** selftest 中每个变体能用 `verifier` 策略跑通；用 diff 确认 `v0` 与其他变体的提示词只在设计规定的位置不同。

### 第 5 步：第 0 轮（冒烟）

锁定种子：`102, 104, 108, 109, 111, 112, 115, 116`。

```bash
npm run pov -- --variants v0-baseline,v1-clear,v2-harness,v3-prompt,v4-belief --trials 2 --label flash-1017-r0
```

- 共 10 局。人工通读全部转录，重点检查：
  1. `ask_staff` 的问题是否被归到正确的歧义编号。
  2. A1–A4 的读法判定与推理文本是否一致。
  3. `sealMentionedBeforeThirdReturn`、`staleFeeUses` 的正则有没有漏判或误判。
- 发现问题就修指标，**不修规则和种子**，否则第 0 轮的结论作废。
- **完成标准：** 指标与人工判读一致；如需修改，在 `FINDINGS.md` 里记录改了什么。

### 第 6 步：第 1 轮（正式）

```bash
npm run pov -- --env <env-file> --variants v0-baseline,v1-clear,v2-harness,v3-prompt,v4-belief --seeds <SEEDS 全部 8 个> --label flash-1017-r1
```

- 共 40 局。按设计文档第 10 节的判定标准逐条给出"成立 / 不成立 / 不确定"，附转录原文引用。
- 结论写入 `FINDINGS.md`。
- **可选：** 用同样的种子跑一次 `deepseek-flash`（规则版本 19 时的对照模型），检验这些习惯是不是 1017 新出现的。

### 第 7 步：同步对比报告

- 在 `report/deepseek-flash-r19-vs-1017-behavior-comparison-2026-10-17.md` 新增第 12 节：验证方法、结果、两条假设是否同源，以及对第 10 节规避建议的修订。
- 如果"厌恶风险"的修正结论被这一轮再次确认，在报告前文出现"保守"描述的地方加注说明。

## 成本估计

每局约 20–40 次工具调用，单周期上下文。第 0 轮 10 局，第 1 轮 40 局；加上可选的 `deepseek-flash` 对照（8 局 × 需要的变体数），总量和第一版 POV 的单轮相当。

## 风险与回退

| 情况 | 处理 |
| --- | --- |
| 第 0 轮发现模型几乎每局都问店员 | H-B 在这个场景下不成立；保留结果，检查是否因为提示词里 "Free" 的措辞太显眼，再决定是否改成更中性的说法并重跑第 0 轮 |
| 找不到 8 个满足全部验收的种子 | 放宽第 4 条（封存时开到生活用品或高价商品），只要求贪心策略会触发封存 |
| 8 个种子结果不稳定 | 扩到 12 个种子，只跑 `v0` 和差异最大的那个变体 |
