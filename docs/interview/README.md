# Interview Guide

本目录用于把项目转化为高级 Web3 工程师面试材料。问题不是背诵题，而是帮助候选人展示系统设计、智能合约安全、后端工程、风控和生产运维能力。

## Files

- [RFQ Questions](rfq-questions.md)
- [Smart Contract Questions](smart-contract-questions.md)
- [Backend Questions](backend-questions.md)
- [System Design Questions](system-design-questions.md)

## Suggested Interview Flow

1. 从 RFQ vs AMM 开始，确认候选人理解业务模型。
2. 进入 EIP-712 和 settlement contract，确认安全边界。
3. 讨论 Quote Service、Risk Engine、Inventory 和 event indexing。
4. 让候选人画出完整 `/quote -> /submit -> settlement -> hedge -> metrics` 流程。
5. 追问故障场景：signer unavailable、chain reorg、hedge failed、market data stale。
