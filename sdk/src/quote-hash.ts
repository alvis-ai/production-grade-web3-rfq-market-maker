import { encodeAbiParameters, keccak256, toBytes } from "viem";
import { toSettlementQuote } from "./settlement.js";
import type { Quote } from "./types.js";

const quoteTypeHash = keccak256(
  toBytes(
    "Quote(address user,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOut,uint256 minAmountOut,uint256 nonce,uint256 deadline,uint256 chainId)",
  ),
);

export function hashSettlementQuote(quote: Quote): `0x${string}` {
  const settlementQuote = toSettlementQuote(quote);

  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [
        quoteTypeHash,
        settlementQuote.user,
        settlementQuote.tokenIn,
        settlementQuote.tokenOut,
        settlementQuote.amountIn,
        settlementQuote.amountOut,
        settlementQuote.minAmountOut,
        settlementQuote.nonce,
        settlementQuote.deadline,
        settlementQuote.chainId,
      ],
    ),
  );
}
