import { privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem/accounts";
import type { SignedQuote } from "../../shared/types/rfq.js";
import { toFixedHex } from "../../shared/types/hex.js";

const RFQ_EIP712_DOMAIN_NAME = "ProductionGradeRFQ";
const RFQ_EIP712_DOMAIN_VERSION = "1";

const quoteTypes = {
  Quote: [
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
} as const;

export interface SignQuoteInput {
  quote: SignedQuote;
  quoteId: string;
  snapshotId: string;
}

export interface SignerService {
  signQuote(input: SignQuoteInput): Promise<`0x${string}`>;
}

export interface LocalEIP712SignerConfig {
  privateKey: `0x${string}`;
  settlementAddress: `0x${string}`;
}

export class LocalEIP712SignerService implements SignerService {
  private readonly account: PrivateKeyAccount;

  constructor(private readonly config: LocalEIP712SignerConfig) {
    this.account = privateKeyToAccount(config.privateKey);
  }

  async signQuote(input: SignQuoteInput): Promise<`0x${string}`> {
    return this.account.signTypedData({
      domain: {
        name: RFQ_EIP712_DOMAIN_NAME,
        version: RFQ_EIP712_DOMAIN_VERSION,
        chainId: input.quote.chainId,
        verifyingContract: this.config.settlementAddress,
      },
      types: quoteTypes,
      primaryType: "Quote",
      message: {
        user: input.quote.user,
        tokenIn: input.quote.tokenIn,
        tokenOut: input.quote.tokenOut,
        amountIn: BigInt(input.quote.amountIn),
        amountOut: BigInt(input.quote.amountOut),
        minAmountOut: BigInt(input.quote.minAmountOut),
        nonce: BigInt(input.quote.nonce),
        deadline: BigInt(input.quote.deadline),
        chainId: BigInt(input.quote.chainId),
      },
    });
  }
}

export class PlaceholderSignerService implements SignerService {
  async signQuote(input: SignQuoteInput): Promise<`0x${string}`> {
    const seed = `${input.quoteId}:${input.snapshotId}:${input.quote.nonce}`;
    const hex = toFixedHex(seed, 130);
    return `0x${hex}`;
  }
}
