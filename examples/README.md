# API Examples

本目录保存 RFQ Market Maker 第一阶段可复用的 API payload。样例用于文档、SDK 调试和未来 smoke test，不代表链上合约已经部署。

## Quote Request

`quote-request.json` 对应未来 REST API：

```http
POST /quote
```

核心链路为：

```text
/quote -> market data -> pricing engine -> risk engine -> EIP-712 signed quote
```

## Submit Request

`submit-request.json` 对应未来 REST API：

```http
POST /submit
```

提交后的链路为：

```text
/submit -> contract verification -> settlement -> inventory update -> hedge engine -> metrics / PnL
```

第一阶段只定义接口形态和端到端数据结构，不要求本地服务、合约或外部链节点可用。
