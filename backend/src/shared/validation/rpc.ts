export interface RpcUrlPolicy {
  requireTls: boolean;
}

const defaultRpcUrlPolicy: RpcUrlPolicy = { requireTls: false };

export function assertRpcUrl(
  value: unknown,
  label: string,
  policy: RpcUrlPolicy = defaultRpcUrlPolicy,
): asserts value is string {
  assertRpcUrlPolicy(policy);
  const requirement = policy.requireTls
    ? "a bounded HTTPS URL without credentials, wildcard hosts, or fragments"
    : "a bounded absolute HTTP(S) URL without credentials, wildcard hosts, or fragments";
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 2_048 ||
    value.trim() !== value
  ) {
    throw new Error(`${label} must use ${requirement}`);
  }
  try {
    const parsed = new URL(value);
    const allowedProtocol = policy.requireTls
      ? parsed.protocol === "https:"
      : parsed.protocol === "http:" || parsed.protocol === "https:";
    if (
      !allowedProtocol ||
      !parsed.hostname ||
      parsed.hostname.includes("*") ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) {
      throw new Error();
    }
  } catch {
    throw new Error(`${label} must use ${requirement}`);
  }
}

function assertRpcUrlPolicy(value: unknown): asserts value is RpcUrlPolicy {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !Object.hasOwn(value, "requireTls") ||
    typeof (value as Record<string, unknown>).requireTls !== "boolean"
  ) {
    throw new Error("RPC URL policy must contain only an own boolean requireTls field");
  }
}

export function assertRpcChainId(value: unknown, expectedChainId: number, label: string): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value !== expectedChainId
  ) {
    throw new Error(`${label} chain ID does not match configured chain ${expectedChainId}`);
  }
}
