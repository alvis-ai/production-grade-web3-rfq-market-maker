# API Examples

本目录保存 RFQ Market Maker 可复用的 API payload。样例用于文档、SDK 调试和本地 smoke test；字段形状由 `make examples-check` 校验。

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

当前 runnable reference 会在本地后端中执行模拟 settlement。`submit-request.json` 的签名只用于字段形状示例；真实 `/submit` smoke path 会先调用 `/quote` 获取后端签出的 EIP-712 signature。
