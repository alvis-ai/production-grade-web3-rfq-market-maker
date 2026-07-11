# Hedge Sequence Diagram

本图描述成交后库存变化如何触发对冲。

```mermaid
sequenceDiagram
  autonumber
  participant Chain as RFQSettlement
  participant Indexer as Event Indexer
  participant Inventory as Inventory Service
  participant Hedge as Hedge Engine
  participant Routing as Routing Engine
  participant Queue as PostgreSQL Lease Queue
  participant Venue as Hedge Venue
  participant Metrics as Metrics / PnL

  Chain-->>Indexer: QuoteSettled event
  Indexer->>Inventory: apply settlement delta
  Inventory->>Inventory: compare exposure with target
  alt Hedge required
    Inventory->>Queue: persist queued hedge intent
    Hedge->>Queue: claim due row with SKIP LOCKED
    Hedge->>Routing: resolve chain/token route and quantity step
    Routing-->>Hedge: venue, symbol, deterministic client id
    Hedge->>Queue: persist route and client id under lease
    Hedge->>Venue: query order by client id
    alt Existing order
      Venue-->>Hedge: pending, filled, or failed
    else Order absent
      Hedge->>Venue: submit signed market order
      Venue-->>Hedge: pending, filled, or failed
    end
    Hedge->>Queue: CAS terminal state or release for retry
    Hedge->>Inventory: apply hedge delta
    Hedge->>Metrics: record hedge cost and lag
  else No hedge required
    Inventory->>Metrics: record exposure only
  end
```

## Notes

- Hedge Engine 是异步路径，不应阻塞链上 settlement。
- 对冲失败必须告警，并影响后续 quote spread 和 risk limit。
- 网络超时或 pending 不是失败证据；必须保留 queued，并在下次 lease claim 后先按 deterministic client id 查询。
