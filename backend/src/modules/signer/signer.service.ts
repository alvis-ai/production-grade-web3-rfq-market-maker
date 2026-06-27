import { recoverTypedDataAddress } from "viem";
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
  verifyQuoteSignature(quote: SignedQuote, signature: `0x${string}`): Promise<boolean>;
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
    return this.account.signTypedData(buildQuoteTypedData(input.quote, this.config.settlementAddress));
  }

  async verifyQuoteSignature(quote: SignedQuote, signature: `0x${string}`): Promise<boolean> {
    let recovered: `0x${string}`;
    try {
      recovered = await recoverTypedDataAddress({
        ...buildQuoteTypedData(quote, this.config.settlementAddress),
        signature,
      });
    } catch {
      return false;
    }

    return recovered.toLowerCase() === this.account.address.toLowerCase();
  }
}

function buildQuoteTypedData(quote: SignedQuote, settlementAddress: `0x${string}`) {
  return {
      domain: {
        name: RFQ_EIP712_DOMAIN_NAME,
        version: RFQ_EIP712_DOMAIN_VERSION,
        chainId: quote.chainId,
        verifyingContract: settlementAddress,
      },
      types: quoteTypes,
      primaryType: "Quote",
      message: {
        user: quote.user,
        tokenIn: quote.tokenIn,
        tokenOut: quote.tokenOut,
        amountIn: BigInt(quote.amountIn),
        amountOut: BigInt(quote.amountOut),
        minAmountOut: BigInt(quote.minAmountOut),
        nonce: BigInt(quote.nonce),
        deadline: BigInt(quote.deadline),
        chainId: BigInt(quote.chainId),
      },
    } as const;
}

export class PlaceholderSignerService implements SignerService {
  async signQuote(input: SignQuoteInput): Promise<`0x${string}`> {
    const seed = `${input.quoteId}:${input.snapshotId}:${input.quote.nonce}`;
    const hex = toFixedHex(seed, 130);
    return `0x${hex}`;
  }

  async verifyQuoteSignature(): Promise<boolean> {
    return false;
  }
}
