#!/usr/bin/env node

// Generates the editable Excalidraw diagrams in docs/diagrams/excalidraw.
// Open the output with https://excalidraw.com or the VS Code Excalidraw extension.

import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const outputDir = "docs/diagrams/excalidraw";

const palette = {
  client: { stroke: "#1971c2", fill: "#d0ebff" },
  gateway: { stroke: "#2f9e44", fill: "#d3f9d8" },
  signer: { stroke: "#e03131", fill: "#ffe3e3" },
  worker: { stroke: "#0c8599", fill: "#c5f6fa" },
  data: { stroke: "#5f3dc4", fill: "#e5dbff" },
  external: { stroke: "#e8590c", fill: "#ffe8cc" },
  chain: { stroke: "#9c36b5", fill: "#f3d9fa" },
  observe: { stroke: "#495057", fill: "#e9ecef" },
  decision: { stroke: "#f08c00", fill: "#fff3bf" },
  reject: { stroke: "#c92a2a", fill: "#fff5f5" },
  success: { stroke: "#2b8a3e", fill: "#ebfbee" },
  note: { stroke: "#f08c00", fill: "#fff9db" },
  iface: { stroke: "#f08c00", fill: "#fff3bf" },
  impl: { stroke: "#1971c2", fill: "#e7f5ff" },
  core: { stroke: "#2f9e44", fill: "#d3f9d8" },
  contract: { stroke: "#9c36b5", fill: "#f3d9fa" },
  zone: { stroke: "#868e96", fill: "transparent" },
};

const fonts = { normal: 2, code: 3 };

class Scene {
  constructor(name) {
    this.name = name;
    this.elements = [];
    this.byId = new Map();
  }

  add(element) {
    this.elements.push(element);
    this.byId.set(element.id, element);
    return element;
  }

  get(id) {
    const element = this.byId.get(id);
    if (!element) throw new Error(`${this.name}: unknown element ${id}`);
    return element;
  }

  toJSON() {
    return {
      type: "excalidraw",
      version: 2,
      source: "https://github.com/alvis-ai/production-grade-web3-rfq-market-maker",
      elements: this.elements,
      appState: { viewBackgroundColor: "#ffffff", gridSize: null },
      files: {},
    };
  }
}

function seedFor(id, salt = "") {
  return createHash("sha256").update(`${id}${salt}`).digest().readUInt32BE(0) % 2_000_000_000;
}

function baseElement(scene, id, type, x, y, width, height, extra = {}) {
  return {
    id: `${scene.name}-${id}`,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: seedFor(`${scene.name}-${id}`),
    version: 1,
    versionNonce: seedFor(`${scene.name}-${id}`, "nonce"),
    isDeleted: false,
    boundElements: [],
    updated: 1,
    link: null,
    locked: false,
    ...extra,
  };
}

function charWidth(char, fontSize, fontFamily) {
  if (/[⺀-￿]/.test(char) && !/[─-╿·]/.test(char)) return fontSize;
  return fontSize * (fontFamily === fonts.code ? 0.6 : 0.55);
}

function measure(text, fontSize, fontFamily) {
  const lines = text.split("\n");
  const width = Math.max(...lines.map((line) => [...line].reduce((sum, c) => sum + charWidth(c, fontSize, fontFamily), 0)));
  return { width: Math.ceil(width), height: Math.ceil(lines.length * fontSize * 1.25) };
}

function textElement(scene, id, text, x, y, options = {}) {
  const fontSize = options.fontSize ?? 16;
  const fontFamily = options.fontFamily ?? fonts.normal;
  const size = measure(text, fontSize, fontFamily);
  return baseElement(scene, id, "text", x, y, size.width, size.height, {
    strokeColor: options.color ?? "#1e1e1e",
    text,
    originalText: text,
    fontSize,
    fontFamily,
    textAlign: options.textAlign ?? "left",
    verticalAlign: options.verticalAlign ?? "top",
    containerId: options.containerId ?? null,
    lineHeight: 1.25,
    autoResize: true,
  });
}

function label(scene, id, text, x, y, options = {}) {
  return scene.add(textElement(scene, id, text, x, y, options));
}

function box(scene, id, text, x, y, width, height, options = {}) {
  const colors = palette[options.kind ?? "gateway"];
  const shape = options.shape ?? "rectangle";
  const container = scene.add(baseElement(scene, id, shape, x, y, width, height, {
    strokeColor: colors.stroke,
    backgroundColor: colors.fill,
    strokeStyle: options.dashed ? "dashed" : "solid",
    roundness: shape === "rectangle" ? { type: 3 } : { type: 2 },
  }));
  if (text) {
    const fontSize = options.fontSize ?? 15;
    const fontFamily = options.fontFamily ?? fonts.normal;
    const textAlign = options.textAlign ?? "center";
    const size = measure(text, fontSize, fontFamily);
    const textX = textAlign === "left" ? x + 12 : x + (width - size.width) / 2;
    const textY = options.verticalAlign === "top" ? y + 10 : y + (height - size.height) / 2;
    const bound = scene.add(textElement(scene, `${id}-text`, text, textX, textY, {
      fontSize,
      fontFamily,
      textAlign,
      verticalAlign: options.verticalAlign ?? "middle",
      containerId: container.id,
    }));
    container.boundElements.push({ type: "text", id: bound.id });
  }
  return container;
}

function zone(scene, id, title, x, y, width, height, options = {}) {
  scene.add(baseElement(scene, id, "rectangle", x, y, width, height, {
    strokeColor: palette.zone.stroke,
    backgroundColor: options.fill ?? "transparent",
    strokeStyle: "dashed",
    strokeWidth: 1,
    roundness: { type: 3 },
  }));
  const titleY = options.titleAtBottom ? y + height - 30 : y + 8;
  label(scene, `${id}-title`, title, x + 14, titleY, { fontSize: 18, color: "#495057" });
}

function anchor(element, side) {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  switch (side) {
    case "top": return [cx, element.y];
    case "bottom": return [cx, element.y + element.height];
    case "left": return [element.x, cy];
    case "right": return [element.x + element.width, cy];
    default: throw new Error(`unknown side ${side}`);
  }
}

function autoSides(from, to) {
  const dx = (to.x + to.width / 2) - (from.x + from.width / 2);
  const dy = (to.y + to.height / 2) - (from.y + from.height / 2);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? ["right", "left"] : ["left", "right"];
  return dy > 0 ? ["bottom", "top"] : ["top", "bottom"];
}

// Connects two elements. `start`/`end` override the attach point as absolute
// [x, y]; `via` adds absolute elbow points between them.
function connect(scene, id, fromId, toId, options = {}) {
  const from = scene.get(`${scene.name}-${fromId}`);
  const to = scene.get(`${scene.name}-${toId}`);
  const [fromSide, toSide] = options.sides ?? autoSides(from, to);
  const start = options.start ?? anchor(from, fromSide);
  const end = options.end ?? anchor(to, toSide);
  const absolute = [start, ...(options.via ?? []), end];
  const points = absolute.map(([px, py]) => [px - start[0], py - start[1]]);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const arrow = scene.add(baseElement(scene, id, "arrow", start[0], start[1],
    Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), {
      strokeColor: options.color ?? "#495057",
      strokeStyle: options.dashed ? "dashed" : "solid",
      strokeWidth: options.strokeWidth ?? 2,
      roundness: options.via ? null : { type: 2 },
      points,
      lastCommittedPoint: null,
      startBinding: { elementId: from.id, focus: 0, gap: 4 },
      endBinding: { elementId: to.id, focus: 0, gap: 4 },
      startArrowhead: null,
      endArrowhead: options.head ?? "arrow",
      elbowed: false,
    }));
  from.boundElements.push({ type: "arrow", id: arrow.id });
  to.boundElements.push({ type: "arrow", id: arrow.id });
  if (options.label) {
    const fontSize = options.labelSize ?? 13;
    const size = measure(options.label, fontSize, fonts.normal);
    const [mx, my] = options.labelAt ?? midpoint(absolute);
    // Excalidraw re-centres bound labels on load, so a pinned position must stay a free text element.
    const pinned = options.labelAt !== undefined;
    const text = scene.add(textElement(scene, `${id}-label`, options.label, mx - size.width / 2, my - size.height / 2, {
      fontSize,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: pinned ? null : arrow.id,
      color: options.color ?? "#495057",
    }));
    if (!pinned) arrow.boundElements.push({ type: "text", id: text.id });
  }
  return arrow;
}

function midpoint(points) {
  const segments = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const length = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    segments.push(length);
    total += length;
  }
  let remaining = total / 2;
  for (let i = 0; i < segments.length; i += 1) {
    if (remaining <= segments[i]) {
      const t = segments[i] === 0 ? 0 : remaining / segments[i];
      return [
        points[i][0] + (points[i + 1][0] - points[i][0]) * t,
        points[i][1] + (points[i + 1][1] - points[i][1]) * t,
      ];
    }
    remaining -= segments[i];
  }
  return points[points.length - 1];
}

function line(scene, id, points, options = {}) {
  const [x, y] = points[0];
  const relative = points.map(([px, py]) => [px - x, py - y]);
  return scene.add(baseElement(scene, id, "line", x, y,
    Math.max(...relative.map((p) => Math.abs(p[0]))), Math.max(...relative.map((p) => Math.abs(p[1]))), {
      strokeColor: options.color ?? "#adb5bd",
      strokeStyle: options.dashed ? "dashed" : "solid",
      strokeWidth: options.strokeWidth ?? 1,
      points: relative,
      lastCommittedPoint: null,
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: null,
    }));
}

function architecture() {
  const s = new Scene("architecture");
  label(s, "title", "RFQ 做市系统 · 整体架构", 40, 20, { fontSize: 28 });

  zone(s, "z-external", "外部依赖", 360, 70, 1200, 140);
  box(s, "cex", "Binance / Coinbase\n行情 WebSocket", 390, 110, 250, 80, { kind: "external" });
  box(s, "rpc", "Chainlink · EVM RPC\n参考价 · 回执 · 区块", 680, 110, 250, 80, { kind: "external" });
  box(s, "kms", "AWS KMS\nsecp256k1 签名密钥", 965, 110, 230, 80, { kind: "external" });
  box(s, "binance", "Binance Spot\n对冲下单 / 成交", 1290, 110, 240, 80, { kind: "external" });

  zone(s, "z-client", "客户端", 40, 250, 280, 560);
  box(s, "fe", "交易前端\nReact · wagmi · RainbowKit", 70, 300, 220, 70, { kind: "client" });
  box(s, "sdk", "TypeScript SDK\nRFQClient · EIP-712", 70, 420, 220, 70, { kind: "client" });
  box(s, "inst", "机构客户端\nAPI Key 鉴权", 70, 540, 220, 70, { kind: "client" });
  box(s, "wallet", "用户钱包\n签名并发送交易", 70, 700, 220, 70, { kind: "client" });

  zone(s, "z-backend", "后端服务（Kubernetes）", 360, 250, 1200, 560, { titleAtBottom: true });
  s.add(baseElement(s, "gw", "rectangle", 390, 290, 480, 490, {
    strokeColor: palette.gateway.stroke,
    backgroundColor: "#f4fce3",
    roundness: { type: 3 },
  }));
  label(s, "gw-title", "RFQ API 网关 · Fastify（main.ts）", 405, 742, { fontSize: 16, color: "#2b8a3e" });
  const modules = [
    ["auth", "鉴权 / 限流\nAPI Key · Redis 令牌桶", 405, 310],
    ["ctl", "报价控制\n全局 / 交易对开关", 640, 310],
    ["md", "市场数据\n多源订单簿校验 · 快照", 405, 415],
    ["route", "路由引擎\n内部库存优先", 640, 415],
    ["price", "定价引擎\n价差 · 规模冲击 · 库存偏移", 405, 520],
    ["risk", "风控引擎\nVaR · Delta/Gamma · 毒性流", 640, 520],
    ["quote", "报价服务\n幂等 · 敞口预留 · 签名编排", 405, 625],
    ["submit", "提交 / 结算核验\n回执确认 · 库存 · PnL", 640, 625],
  ];
  for (const [id, text, x, y] of modules) box(s, id, text, x, y, 215, 80, { kind: "gateway", fontSize: 14 });

  box(s, "signer", "签名服务（signer-main.ts）\n独立校验 · EIP-712 · 审计", 950, 290, 260, 100, { kind: "signer" });

  s.add(baseElement(s, "workers", "rectangle", 1260, 290, 280, 490, {
    strokeColor: palette.worker.stroke,
    backgroundColor: "#f3fbfc",
    roundness: { type: 3 },
  }));
  label(s, "workers-title", "后台 Worker（独立进程）", 1275, 745, { fontSize: 16, color: "#0b7285" });
  const workers = [
    ["hedge", "对冲 Worker\nhedge-worker · fee-worker", 330],
    ["indexer", "结算索引器\nsettlement-indexer", 415],
    ["recon", "对账 Worker\nreconciliation-worker", 500],
    ["toxic", "毒性流分析\ntoxic-flow-analyzer", 585],
    ["analytics", "分析 Worker\nanalytics-worker", 670],
  ];
  for (const [id, text, y] of workers) box(s, id, text, 1280, y, 240, 64, { kind: "worker", fontSize: 14 });

  zone(s, "z-data", "数据层", 360, 860, 1200, 150);
  box(s, "pg", "PostgreSQL\n业务事实来源 · outbox", 390, 905, 250, 80, { kind: "data" });
  box(s, "redis", "Redis\n热状态 · 幂等 · 敞口 · 审计流", 740, 905, 270, 80, { kind: "data" });
  box(s, "redpanda", "Redpanda\nrfq.analytics.v1", 1080, 905, 200, 80, { kind: "data" });
  box(s, "ch", "ClickHouse\n分析查询", 1340, 905, 200, 80, { kind: "data" });

  zone(s, "z-chain", "区块链（EVM）", 40, 1060, 800, 160);
  box(s, "settle", "RFQSettlement\nEIP-712 · nonce · 白名单 · 暂停", 70, 1105, 330, 90, { kind: "chain" });
  box(s, "treasury", "Treasury\n资金托管 · 仅结算合约可 release", 480, 1105, 330, 90, { kind: "chain" });

  zone(s, "z-observe", "可观测性", 900, 1060, 660, 160);
  box(s, "prom", "Prometheus\n抓取各服务 /metrics · 告警", 930, 1105, 270, 90, { kind: "observe" });
  box(s, "grafana", "Grafana\n看板", 1270, 1105, 260, 90, { kind: "observe" });

  connect(s, "a-fe-sdk", "fe", "sdk", { label: "调用" });
  connect(s, "a-sdk-gw", "sdk", "gw", { end: [390, 455], label: "REST" });
  connect(s, "a-inst-gw", "inst", "gw", { end: [390, 575], label: "HTTPS" });
  connect(s, "a-wallet-settle", "wallet", "settle", { start: [180, 770], end: [180, 1105], label: "submitQuote(quote, sig)", labelAt: [262, 935] });
  connect(s, "a-gw-signer", "gw", "signer", { start: [870, 340], end: [950, 340], label: "内部签名" });
  connect(s, "a-signer-kms", "signer", "kms", { start: [1080, 290], end: [1080, 190], label: "Sign(DIGEST)" });
  connect(s, "a-cex-gw", "cex", "gw", { start: [515, 190], end: [515, 290], label: "订单簿推送" });
  connect(s, "a-gw-rpc", "gw", "rpc", { start: [805, 290], end: [805, 190], label: "参考价 · 回执" });
  connect(s, "a-hedge-binance", "hedge", "binance", { start: [1400, 330], end: [1400, 190], label: "限价单 · 查询 · 撤单" });
  connect(s, "a-gw-pg", "gw", "pg", { start: [515, 780], end: [515, 905], label: "结算 · 库存 · PnL" });
  connect(s, "a-gw-redis", "gw", "redis", { start: [820, 780], end: [820, 905], label: "Lua 原子操作" });
  connect(s, "a-signer-redis", "signer", "redis", { start: [980, 390], end: [980, 905], label: "审计 · 最终确认" });
  connect(s, "a-workers-pg", "workers", "pg", {
    start: [1300, 780], via: [[1300, 815], [600, 815]], end: [600, 905], label: "读写业务数据", labelAt: [1150, 801],
  });
  connect(s, "a-redis-pg", "redis", "pg", { start: [740, 960], end: [640, 960], dashed: true, label: "异步投影" });
  connect(s, "a-pg-redpanda", "pg", "redpanda", {
    start: [515, 985], via: [[515, 1030], [1180, 1030]], end: [1180, 985], dashed: true,
    label: "outbox 发布（分析 Worker）", labelAt: [860, 1017],
  });
  connect(s, "a-redpanda-ch", "redpanda", "ch", { label: "消费写入" });
  connect(s, "a-settle-treasury", "settle", "treasury", { label: "资金划转" });
  connect(s, "a-indexer-settle", "indexer", "settle", {
    start: [1520, 447], via: [[1590, 447], [1590, 1250], [235, 1250]], end: [235, 1195],
    dashed: true, label: "索引器定时轮询，经 RPC 拉取 QuoteSettled 日志", labelAt: [1180, 1237],
  });
  connect(s, "a-prom-grafana", "prom", "grafana", { label: "数据源" });
  return s;
}

function quoteFlow() {
  const s = new Scene("quote-flow");
  label(s, "title", "报价到结算 · 业务流程", 40, 20, { fontSize: 28 });
  zone(s, "lane-a", "① 报价阶段（API 网关 + 签名服务）", 40, 70, 740, 1300);
  zone(s, "lane-b", "② 成交与成交后（链上合约 + 后台 Worker）", 820, 70, 760, 1300);

  const main = (id, text, y, h, kind = "gateway") => box(s, id, text, 80, y, 400, h, { kind, fontSize: 14 });
  const decide = (id, text, y) => box(s, id, text, 160, y, 240, 110, { kind: "decision", shape: "diamond", fontSize: 14 });
  const side = (id, text, y, h, kind = "reject") => box(s, id, text, 540, y, 210, h, { kind, fontSize: 13 });

  box(s, "s1", "客户端 POST /quote", 130, 120, 300, 60, { kind: "client", shape: "ellipse", fontSize: 15 });
  main("n1", "鉴权 · 限流 · 请求校验", 220, 60);
  side("r1", "401 / 429 / 400", 220, 60);
  decide("d1", "幂等键\n已存在？", 320);
  side("r2", "返回原签名报价\n（同一请求重放）", 340, 70, "success");
  main("n2", "检查报价控制开关\n读取市场快照（新鲜度 · 多源一致）", 470, 70);
  side("r3", "暂停 / 行情异常\n→ 拒绝报价", 470, 70);
  main("n3", "路由选择 → 定价\n价差 · 规模冲击 · 波动 · 库存偏移", 580, 70);
  main("n4", "风控评估\n限额 · 库存 · VaR · Delta/Gamma · 毒性流 · 日亏损", 690, 70);
  decide("d2", "风控\n通过？", 800);
  side("r4", "409 RISK_REJECTED\n记录拒绝原因", 820, 70);
  main("n5", "索引器守卫 · 金库流动性 · 敞口预留", 950, 60);
  side("r5", "409 RISK_ENGINE_\nUNAVAILABLE", 945, 70);
  main("n6", "签名服务独立校验 → EIP-712 签名\n（生产环境：AWS KMS）", 1050, 70, "signer");
  main("n7", "原子提交：审计 · 幂等 · nonce · 报价最终确认", 1160, 60);
  box(s, "e1", "返回签名报价（短 TTL）", 130, 1260, 300, 60, { kind: "success", shape: "ellipse", fontSize: 15 });

  connect(s, "f-s1-n1", "s1", "n1");
  connect(s, "f-n1-r1", "n1", "r1", { dashed: true, color: "#c92a2a", label: "失败" });
  connect(s, "f-n1-d1", "n1", "d1");
  connect(s, "f-d1-r2", "d1", "r2", { sides: ["right", "left"], color: "#2b8a3e", label: "是" });
  connect(s, "f-d1-n2", "d1", "n2", { label: "否" });
  connect(s, "f-n2-r3", "n2", "r3", { dashed: true, color: "#c92a2a", label: "异常" });
  connect(s, "f-n2-n3", "n2", "n3");
  connect(s, "f-n3-n4", "n3", "n4");
  connect(s, "f-n4-d2", "n4", "d2");
  connect(s, "f-d2-r4", "d2", "r4", { sides: ["right", "left"], color: "#c92a2a", label: "否" });
  connect(s, "f-d2-n5", "d2", "n5", { label: "是" });
  connect(s, "f-n5-r5", "n5", "r5", { dashed: true, color: "#c92a2a", label: "依赖失败" });
  connect(s, "f-n5-n6", "n5", "n6");
  connect(s, "f-n6-n7", "n6", "n7");
  connect(s, "f-n7-e1", "n7", "e1");

  const mainB = (id, text, y, h, kind = "chain") => box(s, id, text, 860, y, 440, h, { kind, fontSize: 14 });
  const sideB = (id, text, y, h, kind = "reject") => box(s, id, text, 1350, y, 210, h, { kind, fontSize: 13 });

  mainB("b1", "用户钱包：approve + submitQuote(quote, sig)", 120, 60, "client");
  mainB("b2", "合约校验\n签名者 · nonce · 截止时间 · chainId · 白名单 · 最小成交量", 220, 70);
  box(s, "db1", "校验\n通过？", 960, 330, 240, 110, { kind: "decision", shape: "diamond", fontSize: 14 });
  sideB("rb1", "交易回滚\n报价保持 signed，到期失效", 350, 70);
  mainB("b3", "tokenIn → Treasury，Treasury release tokenOut 给用户\n核对双边实际余额变化（拒绝扣费代币）", 480, 70);
  mainB("b4", "emit QuoteSettled", 590, 50);
  mainB("b5", "/submit 回执核验 ＋ 结算索引器拉取事件\n两条路径幂等收敛", 680, 70, "worker");
  sideB("rb2", "链重组：回滚孤块事件\n报价恢复 signed", 680, 70, "decision");
  mainB("b6", "对账 Worker：更新库存 · 生成对冲意图 · 计算 PnL", 790, 60, "worker");
  mainB("b7", "对冲 Worker：Binance LIMIT GTC 下单\n查询成交 · 超时撤单", 890, 70, "worker");
  mainB("b8", "手续费对账 → 净 PnL", 1000, 60, "worker");
  box(s, "e2", "成交闭环完成", 930, 1100, 300, 60, { kind: "success", shape: "ellipse", fontSize: 15 });

  connect(s, "f-b1-b2", "b1", "b2");
  connect(s, "f-b2-db1", "b2", "db1");
  connect(s, "f-db1-rb1", "db1", "rb1", { sides: ["right", "left"], color: "#c92a2a", label: "否" });
  connect(s, "f-db1-b3", "db1", "b3", { label: "是" });
  connect(s, "f-b3-b4", "b3", "b4");
  connect(s, "f-b4-b5", "b4", "b5");
  connect(s, "f-b5-rb2", "b5", "rb2", { dashed: true, color: "#f08c00", label: "重组" });
  connect(s, "f-b5-b6", "b5", "b6");
  connect(s, "f-b6-b7", "b6", "b7");
  connect(s, "f-b7-b8", "b7", "b8");
  connect(s, "f-b8-e2", "b8", "e2");
  connect(s, "f-e1-b1", "e1", "b1", {
    start: [430, 1290], via: [[800, 1290], [800, 150]], end: [860, 150],
    color: "#1971c2", label: "用户拿到报价后上链", labelAt: [615, 1277],
  });
  return s;
}

// Renders a sequence diagram. Steps: ["phase", text], ["msg"|"reply"|"async", from, to, text],
// ["note", participant, text], ["frame", label, fromParticipant, toParticipant, kind], ["endFrame"].
function renderSequence(s, title, participants, steps, legend) {
  label(s, "title", title, 40, 20, { fontSize: 28 });
  const spacing = 210;
  const left = 40;
  const top = 80;
  const centers = new Map();
  participants.forEach(([id, text, kind], index) => {
    const x = left + index * spacing;
    box(s, id, text, x, top, 170, 56, { kind, fontSize: 15 });
    centers.set(id, x + 85);
  });
  const width = left + participants.length * spacing;
  const frameColors = { loop: "#0c8599", path: "#1971c2", trigger: "#f08c00" };

  let y = top + 110;
  let messageNumber = 0;
  const openFrames = [];
  const messages = [];
  steps.forEach((step, index) => {
    const [kind] = step;
    if (kind === "phase") {
      line(s, `phase-${index}`, [[left - 10, y - 14], [width, y - 14]], { color: "#ced4da", dashed: true });
      label(s, `phase-${index}-label`, step[1], left, y - 6, { fontSize: 18, color: "#343a40" });
      y += 50;
      return;
    }
    if (kind === "frame") {
      openFrames.push({ index, text: step[1], from: step[2], to: step[3], kind: step[4] ?? "loop", y });
      y += 40;
      return;
    }
    if (kind === "endFrame") {
      const frame = openFrames.pop();
      const color = frameColors[frame.kind];
      const x1 = centers.get(frame.from) - 115;
      const x2 = centers.get(frame.to) + 115;
      s.add(baseElement(s, `frame-${frame.index}`, "rectangle", x1, frame.y - 8, x2 - x1, y - frame.y - 4, {
        strokeColor: color,
        strokeStyle: "dashed",
        strokeWidth: 2,
        roundness: { type: 3 },
      }));
      label(s, `frame-${frame.index}-label`, frame.text, x1 + 10, frame.y, { fontSize: 14, color });
      y += 24;
      return;
    }
    if (kind === "note") {
      const cx = centers.get(step[1]);
      const size = measure(step[2], 13, fonts.normal);
      const width = Math.max(300, size.width + 30);
      const height = size.height + 18;
      box(s, `note-${index}`, step[2], cx - width / 2, y - 14, width, height, { kind: "note", fontSize: 13 });
      y += height + 22;
      return;
    }
    messageNumber += 1;
    const text = `${messageNumber}. ${step[3]}`;
    const size = measure(text, 13, fonts.normal);
    const rowY = y + size.height - 6;
    messages.push({ index, kind, from: step[1], to: step[2], text, y: rowY });
    y = rowY + 40;
  });
  const bottom = y + 10;
  for (const [id] of participants) {
    const cx = centers.get(id);
    line(s, `life-${id}`, [[cx, top + 56], [cx, bottom]], { color: "#adb5bd", dashed: true });
  }
  for (const message of messages) {
    const x1 = centers.get(message.from);
    const x2 = centers.get(message.to);
    const id = `m-${message.index}`;
    const color = message.kind === "async" ? "#7048e8" : message.kind === "reply" ? "#868e96" : "#1e1e1e";
    s.add(baseElement(s, id, "arrow", x1, message.y, Math.abs(x2 - x1), 0, {
      strokeColor: color,
      strokeStyle: message.kind === "msg" ? "solid" : "dashed",
      strokeWidth: 2,
      roundness: null,
      points: [[0, 0], [x2 - x1, 0]],
      lastCommittedPoint: null,
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: "arrow",
    }));
    const size = measure(message.text, 13, fonts.normal);
    const textX = Math.max(left, Math.min(x1, x2) + (Math.abs(x2 - x1) - size.width) / 2);
    label(s, `${id}-label`, message.text, textX, message.y - size.height - 6, { fontSize: 13, color });
  }
  if (legend) {
    const size = measure(legend, 14, fonts.normal);
    box(s, "legend", legend, left, bottom + 30, size.width + 40, size.height + 30,
      { kind: "observe", fontSize: 14, textAlign: "left" });
  }
  return s;
}

const sequenceLegend = [
  "图例",
  "实线箭头 = 主动调用 · 灰色虚线 = 返回结果 · 紫色虚线 = 异步处理",
  "蓝色虚线框 = 并行的写入路径 · 青色虚线框 = 定时轮询循环 · 黄色便签 = 内部处理或说明",
].join("\n");

function quoteSequence() {
  const s = new Scene("quote-sequence");
  return renderSequence(s, "时序图 ①：报价与签名（由用户请求触发）", [
    ["user", "用户 / 前端", "client"],
    ["gw", "API 网关", "gateway"],
    ["redis", "Redis", "data"],
    ["signer", "签名服务", "signer"],
    ["kms", "AWS KMS", "external"],
    ["pg", "PostgreSQL", "data"],
  ], [
    ["phase", "触发：用户调用 POST /quote（同步请求，整个过程在一次 HTTP 请求内完成）"],
    ["msg", "user", "gw", "POST /quote（Idempotency-Key）"],
    ["note", "gw", "鉴权限流 → 读内存热状态：行情快照 · 报价开关\n路由 → 定价 → 风控（全部在网关进程内完成）"],
    ["msg", "gw", "redis", "Lua：幂等 + 报价准备 + 敞口预留"],
    ["msg", "gw", "signer", "POST /internal/sign（报价 + 授权凭证）"],
    ["note", "signer", "独立再校验：链 · 代币 · TTL · 金额上限\n计算 EIP-712 digest"],
    ["msg", "signer", "kms", "Sign(DIGEST, ECDSA_SHA_256)"],
    ["reply", "kms", "signer", "DER 编码的 (r, s)"],
    ["note", "signer", "严格 DER 解析 → low-s → 尝试 v=27/28\n恢复出的地址必须等于可信签名者"],
    ["msg", "signer", "redis", "Lua 原子提交：审计 · nonce · 报价最终确认"],
    ["reply", "signer", "gw", "65 字节签名"],
    ["note", "gw", "网关再次恢复签名者地址核对"],
    ["reply", "gw", "user", "签名报价（quoteId · deadline · signature）"],
    ["phase", "触发：后台 Mirror 持续消费 Redis Stream（不阻塞报价响应）"],
    ["async", "redis", "pg", "报价 · 审计事件异步投影到 PostgreSQL"],
  ], sequenceLegend);
}

function settlementSequence() {
  const s = new Scene("settlement-sequence");
  return renderSequence(s, "时序图 ②：上链结算与成交后处理（谁触发了什么）", [
    ["user", "用户钱包 / 前端", "client"],
    ["gw", "API 网关", "gateway"],
    ["rpc", "EVM 节点（RPC）", "external"],
    ["settle", "RFQSettlement\n+ Treasury", "chain"],
    ["indexer", "结算索引器", "worker"],
    ["pg", "PostgreSQL", "data"],
    ["recon", "对账 Worker", "worker"],
    ["hedge", "对冲 Worker", "worker"],
    ["binance", "Binance", "external"],
  ], [
    ["phase", "A. 用户上链 —— 触发：用户在钱包里确认交易"],
    ["msg", "user", "rpc", "发送交易 submitQuote(quote, sig)"],
    ["msg", "rpc", "settle", "出块时执行 submitQuote"],
    ["note", "settle", "验签 · nonce · deadline · 白名单 · minAmountOut\ntokenIn 转入 Treasury，Treasury release tokenOut 给用户"],
    ["reply", "settle", "rpc", "写入事件日志 QuoteSettled（只记在区块里，不会通知任何服务）"],
    ["reply", "rpc", "user", "交易哈希 / 回执"],
    ["phase", "B. 把成交写进数据库 —— 两条路径并行，谁先到都行，重复写入被幂等跳过"],
    ["frame", "路径 1：用户主动上报 —— 触发：前端调用 POST /submit", "user", "pg", "path"],
    ["msg", "user", "gw", "POST /submit（quote, txHash）"],
    ["msg", "gw", "rpc", "等待交易回执达到 N 个区块确认"],
    ["reply", "rpc", "gw", "回执 + QuoteSettled 日志"],
    ["msg", "gw", "pg", "核验签名者 · 金额后写入 settlement_events"],
    ["endFrame"],
    ["frame", "路径 2：loop 结算索引器定时轮询（示例每 1s）—— 由计时器触发，不依赖用户", "rpc", "pg", "loop"],
    ["msg", "indexer", "pg", "领取游标租约，读取上次检查点（区块号 + 区块哈希）"],
    ["msg", "indexer", "rpc", "检查点区块哈希还对得上吗？（对不上 = 链重组 → 回滚这段事件）"],
    ["msg", "indexer", "rpc", "eth_blockNumber → 安全高度 = 最新高度 − 确认数"],
    ["msg", "indexer", "rpc", "eth_getLogs(QuoteSettled, 游标 .. 安全高度)"],
    ["reply", "rpc", "indexer", "这段新区块里的 QuoteSettled 日志"],
    ["msg", "indexer", "pg", "幂等写入 settlement_events，推进游标并保存新检查点"],
    ["endFrame"],
    ["phase", "C. 成交后处理 —— 触发：数据库触发器入队，Worker 定时轮询领取"],
    ["note", "pg", "触发器 trg_settlement_events_post_trade_reconciliation：\nsettlement_events 新增或 canonical 变化 → 写入 / 更新对账任务"],
    ["frame", "loop 对账 Worker 定时轮询（示例每 250ms）", "pg", "recon", "loop"],
    ["msg", "recon", "pg", "FOR UPDATE SKIP LOCKED 领取对账任务"],
    ["msg", "recon", "pg", "更新报价状态 · 库存 · PnL，生成对冲单（queued）"],
    ["endFrame"],
    ["frame", "loop 对冲 Worker 定时轮询（示例每 250ms）", "pg", "binance", "loop"],
    ["msg", "hedge", "pg", "SKIP LOCKED 领取对冲单"],
    ["msg", "hedge", "binance", "LIMIT GTC 下单 · 查询 · 超时撤单"],
    ["reply", "binance", "hedge", "成交 + 手续费"],
    ["msg", "hedge", "pg", "写入成交证据，手续费对账后得到净 PnL"],
    ["endFrame"],
  ], sequenceLegend);
}

function classDiagram() {
  const s = new Scene("class-diagram");
  label(s, "title", "核心类图 · 报价服务与成交后处理", 40, 0, { fontSize: 28 });
  const code = { fontFamily: fonts.code, fontSize: 14, textAlign: "left", verticalAlign: "top" };
  const heightOf = (text) => measure(text, 14, fonts.code).height + 22;
  const iface = (id, name, methods, x, y, w) => {
    const text = `«interface»\n${name}\n${"─".repeat(Math.floor((w - 24) / 8.4))}\n${methods.join("\n")}`;
    return box(s, id, text, x, y, w, heightOf(text), { kind: "iface", ...code });
  };
  const klass = (id, name, members, x, y, w, kind = "impl") => {
    const text = members.length ? `${name}\n${"─".repeat(Math.floor((w - 24) / 8.4))}\n${members.join("\n")}` : name;
    return box(s, id, text, x, y, w, heightOf(text), { kind, ...code });
  };
  const implement = (implId, ifaceId) => connect(s, `impl-${implId}`, implId, ifaceId, {
    dashed: true, head: "triangle", color: "#1971c2",
  });
  const uses = (fromId, toId, options = {}) => connect(s, `use-${fromId}-${toId}`, fromId, toId, {
    color: "#495057", ...options,
  });

  // Upper ring: quote inputs.
  klass("cachedMd", "CachedMarketDataService", [], 20, 50, 240);
  klass("chainlinkMd", "ChainlinkMarketDataService", [], 280, 50, 250);
  iface("md", "MarketDataService", ["+ getSnapshot()"], 150, 170, 260);
  klass("formula", "FormulaPricingEngine", [], 580, 50, 210);
  klass("cachedPricing", "CachedPricingEngine", [], 810, 50, 210);
  iface("pricing", "PricingEngine", ["+ price()"], 670, 170, 260);
  klass("tokenLimit", "TokenLimitRiskEngine", [], 1070, 50, 220);
  klass("toxic", "DynamicToxicFlowRiskEngine", [], 1310, 50, 250);
  klass("dailyLoss", "DailyLossRiskEngine", [], 1580, 50, 220);
  iface("risk", "RiskEngine", ["+ evaluate()", "+ checkHealth()"], 1310, 170, 250);
  klass("internalRoute", "InternalInventoryRoutingEngine", [], 1860, 50, 290);
  iface("routing", "RoutingEngine", ["+ selectRoute()"], 1880, 170, 250);

  klass("quoteService", "QuoteService", [
    "+ createQuote(request, ctx)",
    "+ getQuoteStatus(quoteId)",
    "+ requireSubmittableSignedQuote()",
    "+ markQuoteStatus(quoteId, status)",
  ], 900, 410, 350, "core");

  // Lower ring: signing, admission and inventory.
  iface("signerSvc", "SignerService", ["+ signQuote()", "+ verifyQuoteSignature()"], 150, 690, 260);
  klass("remoteSigner", "RemoteSignerService", [], 20, 880, 240);
  klass("kmsSigner", "KmsSignerService", [], 280, 880, 230);
  iface("exposure", "QuoteExposureStore", ["+ reserve()", "+ release()"], 670, 690, 260);
  klass("redisExposure", "RedisQuoteExposureStore", [], 560, 880, 240);
  klass("pgExposure", "PostgresQuoteExposureStore", [], 820, 880, 260);
  iface("issuance", "QuoteIssuanceStore", ["+ prepare()", "+ authorize()", "+ finalize()"], 1240, 690, 260);
  klass("redisIssuance", "RedisQuoteIssuanceStore", [], 1110, 880, 250);
  klass("pgIssuance", "PostgresQuoteIssuanceStore", [], 1380, 880, 260);
  iface("inventory", "IInventoryService", ["+ projectSettlement()", "+ applySettlement()", "+ getPosition()"], 1830, 690, 260);
  klass("pgInventory", "PostgresInventoryService", [], 1680, 880, 250);
  klass("hotInventory", "RefreshingInventoryView", [], 1950, 880, 240);

  iface("kmsProvider", "KmsSignerProvider", ["+ signDigest()"], 280, 990, 240);
  klass("awsKms", "AwsKmsSignerProvider", [], 280, 1140, 240);

  for (const [implId, ifaceId] of [
    ["cachedMd", "md"], ["chainlinkMd", "md"], ["formula", "pricing"], ["cachedPricing", "pricing"],
    ["tokenLimit", "risk"], ["toxic", "risk"], ["dailyLoss", "risk"], ["internalRoute", "routing"],
    ["remoteSigner", "signerSvc"], ["kmsSigner", "signerSvc"], ["redisExposure", "exposure"],
    ["pgExposure", "exposure"], ["redisIssuance", "issuance"], ["pgIssuance", "issuance"],
    ["pgInventory", "inventory"], ["hotInventory", "inventory"], ["awsKms", "kmsProvider"],
  ]) implement(implId, ifaceId);
  for (const target of ["md", "pricing", "risk", "routing"]) uses("quoteService", target, { sides: ["top", "bottom"] });
  for (const target of ["signerSvc", "exposure", "issuance", "inventory"]) uses("quoteService", target, { sides: ["bottom", "top"] });
  uses("kmsSigner", "kmsProvider", { sides: ["bottom", "top"] });

  // Post-trade workers.
  zone(s, "z-post", "成交后处理（独立 Worker 进程）", 600, 1010, 1600, 520);
  klass("indexerWorker", "SettlementIndexerWorker", ["+ runChainOnce(chainId)"], 630, 1060, 290);
  klass("indexerStore", "PostgresSettlementIndexerStore", ["+ claimCursor()", "+ advanceCursor()", "+ rollbackCursor()"], 630, 1220, 290);
  klass("reconWorker", "PostTradeReconciliationWorker", ["+ runOnce()"], 980, 1060, 300);
  klass("reconService", "ReconciliationService", ["+ reconcileSettlementToQuote()", "+ reconcileSettlementToPnl()"], 980, 1200, 300);
  iface("planner", "HedgeIntentPlanner", ["+ plan()"], 980, 1340, 300);
  klass("deltaNeutral", "DeltaNeutralHedgePlanner", [], 980, 1460, 300);
  klass("hedgeWorker", "HedgeWorker", ["+ runOnce()"], 1360, 1060, 260);
  klass("feeWorker", "HedgeFeeWorker", ["+ runOnce()"], 1680, 1060, 260);
  iface("cexAdapter", "CexExecutionAdapter", ["+ submitLimitOrder()", "+ queryOrder()", "+ cancelOrder()"], 1500, 1220, 280);
  klass("binanceAdapter", "BinanceSpotAdapter", [], 1500, 1400, 280);

  uses("indexerWorker", "indexerStore", { sides: ["bottom", "top"] });
  uses("reconWorker", "reconService", { sides: ["bottom", "top"] });
  uses("reconService", "planner", { sides: ["bottom", "top"] });
  connect(s, "impl-deltaNeutral", "deltaNeutral", "planner", { sides: ["top", "bottom"], dashed: true, head: "triangle", color: "#1971c2" });
  uses("hedgeWorker", "cexAdapter", { sides: ["bottom", "top"], start: [1490, 1140], end: [1580, 1220] });
  uses("feeWorker", "cexAdapter", { sides: ["bottom", "top"], start: [1810, 1140], end: [1700, 1220] });
  connect(s, "impl-binanceAdapter", "binanceAdapter", "cexAdapter", { sides: ["top", "bottom"], dashed: true, head: "triangle", color: "#1971c2" });

  // Contracts.
  zone(s, "z-contracts", "Solidity 合约", 20, 1580, 1400, 260);
  klass("settlement", "RFQSettlement", [
    "+ submitQuote(quote, signature)",
    "+ setTrustedSigner(signer)",
    "+ setTrustedSignerAuthorization(signer, bool)",
    "+ setTokenWhitelist(token, bool)",
    "+ setPaused(bool)",
    "+ hashQuote(quote)",
  ], 50, 1630, 400, "contract");
  klass("treasuryContract", "Treasury", [
    "+ release(token, to, amount)",
    "+ emergencyWithdraw(token, to, amount)",
    "+ setSettlement(settlement)",
  ], 560, 1630, 360, "contract");
  klass("factory", "RFQDeploymentFactory", [
    "一次交易部署 Settlement + Treasury",
    "绑定后把全部角色移交给最终管理员",
  ], 1020, 1630, 370, "contract");
  uses("settlement", "treasuryContract", { label: "release()" });
  uses("factory", "treasuryContract", { label: "部署", dashed: true });
  uses("factory", "settlement", {
    start: [1205, 1720], via: [[1205, 1810], [250, 1810]], end: [250, 1790], dashed: true, label: "部署", labelAt: [730, 1797],
  });

  box(s, "legend", "图例\n黄色 = 接口 · 蓝色 = 实现类 · 绿色 = 核心服务 · 紫色 = 合约\n虚线 + 三角箭头 = 实现接口 · 实线箭头 = 依赖 / 调用",
    1480, 1600, 700, 110, { kind: "observe", fontSize: 14, textAlign: "left" });
  return s;
}

await mkdir(outputDir, { recursive: true });
for (const [file, build] of [
  ["architecture.excalidraw", architecture],
  ["quote-flow.excalidraw", quoteFlow],
  ["quote-sequence.excalidraw", quoteSequence],
  ["settlement-sequence.excalidraw", settlementSequence],
  ["class-diagram.excalidraw", classDiagram],
]) {
  const scene = build();
  await writeFile(`${outputDir}/${file}`, `${JSON.stringify(scene.toJSON(), null, 2)}\n`);
  console.log(`wrote ${outputDir}/${file} (${scene.elements.length} elements)`);
}
