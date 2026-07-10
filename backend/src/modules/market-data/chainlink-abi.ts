export const chainlinkAggregatorV3Abi = [
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ type: "uint8", name: "decimals" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "latestRoundData",
    inputs: [],
    outputs: [
      { type: "uint80", name: "roundId" },
      { type: "int256", name: "answer" },
      { type: "uint256", name: "startedAt" },
      { type: "uint256", name: "updatedAt" },
      { type: "uint80", name: "answeredInRound" },
    ],
    stateMutability: "view",
  },
] as const;
