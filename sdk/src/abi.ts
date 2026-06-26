export const rfqSettlementAbi = [
  {
    type: "function",
    name: "domainSeparator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "hashTypedData",
    stateMutability: "view",
    inputs: [{ name: "structHash", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "setPaused",
    stateMutability: "nonpayable",
    inputs: [{ name: "newPaused", type: "bool" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setTokenWhitelist",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "whitelisted", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setTrustedSigner",
    stateMutability: "nonpayable",
    inputs: [{ name: "newTrustedSigner", type: "address" }],
    outputs: [],
  },
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
    type: "function",
    name: "transferOwnership",
    stateMutability: "nonpayable",
    inputs: [{ name: "newOwner", type: "address" }],
    outputs: [],
  },
  {
    type: "event",
    name: "OwnerUpdated",
    inputs: [
      { name: "oldOwner", type: "address", indexed: true },
      { name: "newOwner", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "PausedUpdated",
    inputs: [{ name: "paused", type: "bool", indexed: false }],
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
  {
    type: "event",
    name: "TokenWhitelistUpdated",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "whitelisted", type: "bool", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TrustedSignerUpdated",
    inputs: [
      { name: "oldSigner", type: "address", indexed: true },
      { name: "newSigner", type: "address", indexed: true },
    ],
  },
] as const;
