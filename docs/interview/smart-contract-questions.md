# Smart Contract Interview Questions

## 1. RFQSettlement 合约的最小职责是什么？

考察点：签名验证、nonce、防过期、token whitelist、资产转移和事件。

## 2. 为什么合约不应该重新计算复杂报价？

考察点：gas、确定性、策略保密、链下风险和审计边界。

## 3. EIP-712 domain separator 应包含哪些字段？

考察点：name、version、chainId、verifyingContract。

## 4. 如何防止 quote replay？

考察点：nonce mapping、bitmap、状态更新顺序和链上事件。

## 5. `deadline` 应该在合约中如何验证？

考察点：`block.timestamp`、短 TTL、过期交易拒绝。

## 6. token whitelist 解决什么问题？

考察点：非标准 ERC20、fee-on-transfer、rebasing、恶意 token。

## 7. SafeERC20 为什么必要？

考察点：不返回 bool 的 ERC20、兼容性和安全转账。

## 8. ReentrancyGuard 应保护哪个入口？

考察点：`submitQuote` 和外部 token 调用。

## 9. Pausable 在 RFQ 系统中的作用是什么？

考察点：signer 泄露、资产异常、市场异常和应急响应。

## 10. 如何测试 wrong signer？

考察点：使用不同私钥签名、期望 revert。

## 11. 如何测试 wrong chainId？

考察点：typed data chainId 与 block.chainid 不一致。

## 12. 如何处理签名密钥轮换？

考察点：添加新 signer、等待旧 quote 过期、移除旧 signer。

## 13. 事件中应该包含哪些字段？

考察点：quoteHash、user、tokenIn、tokenOut、amount、nonce、幂等索引。

## 14. 合约是否需要保存完整 quote？

考察点：gas 成本、事件、链下索引、最小状态。

## 15. 如何设计 treasury 边界？

考察点：资金托管、权限、提款、settlement 合约授权。
