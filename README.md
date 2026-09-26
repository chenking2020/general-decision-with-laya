# Decidra · 多语言通用决策平台

> 对标 Palantir，但方法论相反：不先造一个世界模型再在里面查询，
> 而是把**每一次判断本身**原子化成类型化问题，用一次前向传播得到带概率的答案，
> 再用置信门控决定「自动执行」还是「升级人工」。

底层引擎是本地权重 [`convaiinnovations/laya-multilingual`](https://www.modelscope.cn/models/convaiinnovations/laya-multilingual)
（mmBERT-base 307M + 2 层决策头，322M 参数，100+ 语言，非自回归，RLCD 训练）。
仓库内 `weights/laya-multilingual` 已经是完整可离线加载的检查点，运行时**不访问网络**。

---

## 一、方法论：决策驱动 vs 本体驱动

| 维度 | Palantir（本体驱动） | Decidra（决策驱动） |
|---|---|---|
| 核心抽象 | 本体（Ontology）：先把组织的数据、对象、关系建模成世界模型 | 决策原子（Decision Atom）：把一次判断拆成带类型的问题集 |
| 前置成本 | 数据接入、实体对齐、本体建模先完成，决策能力才出现 | 零前置：给一段状态 + 一组问题，第一次调用就产出决策 |
| 答案形态 | 查询结果、图谱路径、生成式结论 | 类型化取值 + 完整概率分布 + 集中度 + 门控裁决 |
| 时延 | 秒级～分钟级（含 LLM 环节更慢） | 单次前向：1 问 ≈ 33 ms，批量 ≈ 7 ms/问 |
| 不确定性 | 主要由人把握 | 一等公民：被标定、被画成曲线、被阈值化成策略 |
| 失败模式 | 本体建错/数据滞后 → 系统性偏移且往往无声 | 分布平坦 → 置信度低 → 显式升级人工 |
| 语言 | 以英文生态为主 | 100+ 语言，同一套问题、同一个检查点 |
| 成本 | 平台 + 实施 + 持续数据工程 | 开源权重单机自托管，边际成本趋近于零 |

**五步法**：状态（State） → 类型化问题（choice / score / noul） → 一次前向传播 → 概率 → 门控。

**为什么概率可信**：RLCD 用严格适当评分规则训练——模型只有如实报告信念时期望奖励才最大。
但「可标定 ≠ 已标定」：本检查点出厂 `temperature = [1.0, 1.0, 1.0]`，系统性过度自信，
所以平台把**温度拟合**与**阈值扫描**做成一等公民功能，而不是留给使用者自己拍脑袋。

二者不互斥：本体擅长回答「世界是什么样」，决策引擎擅长回答「此刻该做什么、有多确定」。
生产系统里 Decidra 通常站在最前面，用 30 ms 决定这条输入该走哪条路、要不要交给更贵更慢的系统。

---

## 二、快速开始

```bash
# 1) 后端（Python ≥ 3.10）
python3 -m venv .venv
.venv/bin/pip install -r server/requirements.txt
.venv/bin/python server/run.py            # http://127.0.0.1:8000

# 2) 前端（开发模式，已配置 /api → 8000 代理）
cd web && npm install && npm run dev      # http://127.0.0.1:5173

# 或：构建产物交给后端托管，只开一个端口
cd web && npm run build && cd .. && .venv/bin/python server/run.py

# 也可以一条命令（含建环境、装依赖、构建、启动）
./start.sh
```

首次启动会把 322M 权重读进内存（Apple Silicon 上约 8–10 秒，自动使用 MPS）。
设备可用 `LAYA_DEVICE=cuda|mps|cpu` 指定，长文档用 `LAYA_MAX_LEN=8192`。

---

## 三、功能地图

| 页面 | 作用 |
|---|---|
| **总览** | 决策量、自动执行率、平均置信、置信直方图、近 14 天趋势、引擎状态 |
| **决策工作台** | 输入状态（文本 / JSON）+ 可视化编写 choice / score / noul，一次前向出全部答案；可打真值、可存为蓝图 |
| **蓝图库** | 31 张内置决策蓝图、20 个领域（客户运营 / 风控合规 / 内容安全 / 研发运维 / 销售市场 / 人力资源 / 医疗健康 / 公共部门 / 投资研究 / 个人决策 / 通用办公 / 电商零售 / 营销合规 / 金融保险 / 信息安全 / 舆情公关 / 供应链 / 产品管理 / 教育教学 / 数据运营），支持自建与克隆 |
| **批量决策** | CSV / JSON / 逐行文本导入 → 共享前向传播批量打分 → 分流统计 → 导出 CSV → 逐条标注 |
| **决策账本** | 每次决策的完整留痕（状态、问题集、概率分布、语言路由、耗时、裁决），可回溯、可标注、可删除 |
| **标定与门控** | 准确率 / ECE / Brier / MAE 指标、覆盖率↔准确率扫描曲线、一键拟合各类型温度并应用到运行时 |
| **方法论** | 与 Palantir 的逐维度对照、三原语、门控经济学、什么时候不该用它、模型卡 |

---

## 四、目录结构

```
weights/laya-multilingual/        本地检查点（model.safetensors + tokenizer + rl_agent_config.json）
server/
  run.py                          启动脚本（--host/--port/--device/--no-preload）
  requirements.txt
  app/
    config.py                     路径、设备、默认阈值
    engine.py                     Laya 引擎单例：加载、推理、结果规范化、温度缩放、门控
    calibration.py                指标 / ECE / 阈值扫描 / 温度拟合
    store.py                      SQLite 持久化（账本、反馈、蓝图、设置）
    blueprints_data.py            内置蓝图库
    schemas.py                    pydantic 模型
    routers/                      meta / decisions / blueprints / ledger / calibration
web/                              React 18 + Vite + TS + Tailwind 前端
  src/pages/                      7 个页面
  src/components/                 Layout / ui / QuestionEditor / AnswerCard
  src/lib/                        api.ts / types.ts / format.ts / MetaContext
server/data/decidra.db            运行时生成的 SQLite（已在 .gitignore）
```

---

## 五、HTTP API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/meta` | 引擎信息 + 设置 |
| POST | `/api/route` | 只做脚本 / 语言分析，不走前向 |
| POST | `/api/decide` | 单条决策，返回答案、概率、门控、账本 ID |
| POST | `/api/decide/batch` | 批量决策（共享前向） |
| POST | `/api/ingest/parse` | CSV / JSON / 逐行文本 → 批量条目 |
| GET/POST/PUT/DELETE | `/api/blueprints` | 蓝图 CRUD |
| GET | `/api/ledger`、`/api/ledger/stats` | 账本与统计 |
| POST | `/api/ledger/{id}/feedback` | 给某个答案打真值（成为标定样本） |
| POST | `/api/calibration/metrics` · `/sweep` · `/fit` · `/apply` | 指标、阈值扫描、温度拟合与应用 |
| GET/PUT | `/api/settings` | 阈值、温度、自动执行开关 |

交互文档：`http://127.0.0.1:8000/docs`

一段最小调用：

```bash
curl -s localhost:8000/api/decide -H 'content-type: application/json' -d '{
  "state": {"body": "我被重复扣款了，请今天退款，否则我们取消套餐。"},
  "questions": {
    "department": {"type": "choice", "instructions": "Which team should handle this?",
                   "criteria": {"billing": "invoices, refunds", "technical": "bugs, outages"}},
    "refund_requested": {"type": "noul", "instructions": "Does the sender ask for money back?"}
  }
}'
```

---

## 六、语言约定

* **决策维度用中文**：问题名、选项标签、等级描述、门控说明一律中文——
  使用者以中文编写、阅读与复核。例如「归属团队 / 紧急度 / 情绪强度 / 流失风险 / 要求退款」。
* **多语言只作用于原始数据**：被决策的对象（工单、交易、帖子、告警）可以是英、日、西、阿、印地等
  任意语言，同一个检查点、同一套中文维度一次前向完成。
* **蓝图样例以中文为主**：内置蓝图的示例状态默认给中文（可直接改、可直接跑），
  另附 1–2 条多语言原始数据样例用于验证跨语言表现。
* **是非题的显示**：内部取值仍是 `true / false`，界面统一显示为「是 / 否」。

## 七、编写问题的三条硬规则

1. **choice 选项 ≤ 20 个**，且绝不使用 `true/false`、`yes/no` 之类的真值词做标签
   （模型会跟着标签走而不是跟着内容走）——平台在保存蓝图时会直接拒绝。
2. **score 等级 ≤ 5 级**，每一级都要写清楚判据；这是最弱的原语，能用 choice 就别用。
3. **noul 只问一个命题**；概率落在 0.5 附近时，门控会强制升级人工。

---

## 八、致谢与许可

* 模型：[convaiinnovations/laya-multilingual](https://www.modelscope.cn/models/convaiinnovations/laya-multilingual) · Apache 2.0 · Convai Innovations
* 库：`pip install laya` · 文档 https://nandhakishorm.github.io/laya/ · 官方演示 https://huggingface.co/spaces/convaiinnovations/laya-demo
* 本平台代码同样以 Apache 2.0 发布。

## 九、Star History

如果这个项目对你有帮助，欢迎点个 Star ⭐

[![Star History Chart](https://api.star-history.com/svg?repos=chenking2020/general-decision-with-laya&type=Date)](https://www.star-history.com/#chenking2020/general-decision-with-laya&Date)

