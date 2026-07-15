export const usdReferenceRuntimeEnvName = "RFQ_USD_REFERENCE_CONFIG_JSON";
export const dailyLossRuntimeEnvName = "RFQ_DAILY_LOSS_CONFIG_JSON";

export function configureUsdReferenceEnvironment() {
  process.env[usdReferenceRuntimeEnvName] = JSON.stringify({
    policyVersion: "usd-reference-test-v1",
    networks: [{
      chainId: 1,
      networkType: "l1",
      rpcUrl: "https://rpc.example.com/v1/key",
      feeds: [{
        tokenAddress: "0x0000000000000000000000000000000000000003",
        aggregator: "0x0000000000000000000000000000000000000005",
        decimals: 8,
        description: "TOKEN3 / USD",
        minAnswer: "90000000",
        maxAnswer: "110000000",
      }],
    }],
    maxPriceAgeMs: 60_000,
    maxFutureSkewMs: 1_000,
    maxDeviationBps: 100,
    cacheTtlMs: 1_000,
  });
  process.env[dailyLossRuntimeEnvName] = JSON.stringify({
    policyVersion: "daily-loss-test-v1",
    limits: [{
      chainId: 1,
      tokenAddress: "0x0000000000000000000000000000000000000003",
      maxLossUsdE18: "100000000000000000000",
    }],
  });
}
