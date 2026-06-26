export const rfqSettlementAbi = [
  {
    type: "function",
    name: "submitQuote",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "quote",
        type: "tuple",
        components: [
          { name: "user", type: "address" },
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOut", type: "uint256" },
          { name: "minAmountOut", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "chainId", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    type: "event",
    name: "QuoteSettled",
    inputs: [
      { name: "quoteHash", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "tokenIn", type: "address", indexed: true },
      { name: "tokenOut", type: "address", indexed: false },
      { name: "amountIn", type: "uint256", indexed: false },
      { name: "amountOut", type: "uint256", indexed: false },
      { name: "nonce", type: "uint256", indexed: false },
    ],
  },
] as const;
