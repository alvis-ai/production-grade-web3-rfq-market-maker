# Chapter 02: Kubernetes

## Abstract

Kubernetes 是本项目的生产运行目标之一。RFQ 系统包含 API、Quote、Pricing、Risk、Signer、Execution、Inventory、Hedge 和 Metrics 等服务，Kubernetes 可以提供部署、扩缩容、配置、健康检查和滚动更新。

## Learning Objectives

- 理解 RFQ 服务如何映射为 Kubernetes workloads。
- 区分 stateless services 和 stateful dependencies。
- 定义 readiness、liveness 和 resource limits。
- 说明 signer 的隔离部署要求。

## Background

生产 RFQ 系统需要隔离安全边界。Signer Service 不应与公开 API 混在同一个容器或权限域中。Kubernetes 的 namespace、service account、network policy 和 secret 管理可以表达这些边界。

## Problem Statement

需要把服务拆分和部署边界对齐，避免所有组件用同一权限运行。

## Requirements

### Functional Requirements

- 部署 API Gateway。
- 部署 Quote/Pricing/Risk/Signer 服务。
- 部署 Execution/Inventory/Hedge 服务。
- 配置 service discovery。
- 配置 readiness/liveness probes。

### Non-Functional Requirements

- Signer 必须网络隔离。
- Secret 不写入镜像。
- Resource request/limit 明确。
- 支持滚动发布和回滚。

## Existing Solutions

可以使用 Kubernetes、Docker Compose 生产化或 PaaS。生产级多服务系统更适合 Kubernetes + Helm。

## Trade-Off Analysis

Kubernetes 运维复杂，但能表达服务隔离和弹性。对于生产级参考架构，该复杂度合理。

## System Design

```mermaid
flowchart TB
  Ingress[Ingress]
  API[api-gateway Deployment]
  Quote[quote Deployment]
  Risk[risk Deployment]
  Signer[signer Deployment]
  Worker[workers Deployment]
  Secrets[Kubernetes Secrets]
  Network[NetworkPolicy]

  Ingress --> API
  API --> Quote
  Quote --> Risk
  Risk --> Signer
  Worker --> Quote
  Secrets --> Signer
  Network --> Signer
```

## Architecture Diagram

Signer Service should run in a restricted namespace or with strict NetworkPolicy. Public ingress only reaches API Gateway.

## Sequence Diagram

```mermaid
sequenceDiagram
  autonumber
  participant User
  participant Ingress
  participant API
  participant Quote
  participant Signer

  User->>Ingress: HTTPS /quote
  Ingress->>API: route request
  API->>Quote: createQuote
  Quote->>Signer: sign approved quote
```

## State Machine

```mermaid
stateDiagram-v2
  [*] --> Deploying
  Deploying --> Ready
  Ready --> RollingUpdate
  RollingUpdate --> Ready
  RollingUpdate --> Rollback
  Rollback --> Ready
```

## Data Model

Kubernetes config includes Deployment, Service, ConfigMap, Secret, ServiceAccount, NetworkPolicy, HorizontalPodAutoscaler and PodDisruptionBudget.

The current runnable backend manifests use:

- `rfq-backend-config` ConfigMap for non-secret runtime settings such as `HOST=0.0.0.0`, `PORT=3000` and `NODE_ENV=production`.
- `rfq-backend-secrets` Secret for `DATABASE_URL`、`RFQ_SIGNER_PRIVATE_KEY`、`RFQ_SETTLEMENT_ADDRESS` and `RFQ_REDIS_URL`.
- Any non-local `NODE_ENV` requires `DATABASE_URL`. The API does not allow pod-local quote, settlement, inventory, hedge or PnL stores in production; Helm injects the URL through `databaseSecret`.
- `RFQ_RATE_LIMIT_BACKEND=redis` is mandatory in production. `RFQ_REDIS_URL` may contain credentials or TLS parameters, so Kubernetes and Helm inject it from the Secret; `/ready` verifies it through the `rateLimitStore` component.
- Chainlink deployments set `RFQ_MARKET_DATA_PROVIDER=chainlink` in the ConfigMap and store the complete `RFQ_CHAINLINK_CONFIG_JSON` in `rfq-backend-secrets`, because RPC URLs commonly contain provider credentials. The Helm chart exposes this key only when `chainlinkConfigSecret.enabled=true`; static deployments do not mount a placeholder oracle config.
- Production settlement sets `RFQ_ALLOW_SIMULATED_SETTLEMENT=false` and injects `RFQ_RECEIPT_CONFIG_JSON` from `rfq-backend-secrets`. Each chain entry fixes `rpcUrl`、`settlementAddress`、required confirmations and receipt timeout; its settlement address must equal the EIP-712 `RFQ_SETTLEMENT_ADDRESS`. Helm enables `receiptConfigSecret` by default, so the existing signer Secret must also contain this key before rollout.
- Helm `signerSecret` values to reference the Secret name and key names without embedding private values into chart templates.
- `terminationGracePeriodSeconds=30` and a `preStop` sleep of 5 seconds to give readiness and load balancers time to stop sending new quote traffic before the backend receives SIGTERM and closes Fastify.

## API Design

No public API changes. Ingress exposes only public endpoints.

## Engineering Decisions

- Helm manages manifests.
- Signer has separate service account and network policy.
- Readiness 使用 `/ready` 检查关键组件状态，liveness 使用 `/health` 检查进程存活，避免坏版本进入流量。
- Backend pods use graceful shutdown on `SIGTERM`/`SIGINT`; Kubernetes keeps a termination grace period and preStop delay so rolling updates avoid abruptly cutting in-flight quote or submit requests.
- `NODE_ENV=production` requires explicit signer configuration. `RFQ_SIGNER_PRIVATE_KEY` must be a 32-byte hex string and `RFQ_SETTLEMENT_ADDRESS` must be a 20-byte hex address; placeholder Secret values must be replaced before deploy.

## Failure Scenarios

- Bad deployment：rollback Helm release.
- Signer pod crashloop：disable quote signing and page operator.
- Dependency unavailable：readiness fails.
- Missing or malformed signer Secret：backend fails fast before serving traffic.
- Missing or malformed Redis Secret：backend fails fast；runtime Redis loss returns 503 and removes the pod from readiness without bypassing global limits.
- Pod termination during rollout：preStop delay lets endpoints drain, then SIGTERM triggers Fastify close; forced kill before grace period ends should be treated as a deployment incident.

## Security Considerations

Use least privilege service accounts. Avoid mounting broad secrets into API pods. Use network policy to restrict Signer access.

## Performance Considerations

Scale API and Quote services horizontally. Scale Signer carefully with key policy and KMS limits.

## Testing Strategy

Validate manifests with dry-run, run smoke tests after deploy, test rollback path.

## Interview Notes

Kubernetes 的价值不是“能部署”，而是能表达隔离、健康、回滚和扩缩容。

## Summary

Kubernetes 是生产部署层。RFQ 系统的部署设计必须特别保护 Signer 和 post-trade worker。

## References

- Kubernetes Deployments
- NetworkPolicy
- Helm
