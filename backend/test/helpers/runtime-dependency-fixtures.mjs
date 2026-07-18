export function unusedTreasuryLiquidityProvider() {
  return {
    async checkHealth() {},
    async getLiquidity() {
      throw new Error("unused Treasury liquidity provider");
    },
  };
}
