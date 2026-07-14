export const localPrincipalId = "local";
export const maxPrincipalIdLength = 128;

const principalIdPattern = /^[A-Za-z0-9_:-]+$/;

export function assertPrincipalId(value: unknown, label = "principalId"): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxPrincipalIdLength ||
      !principalIdPattern.test(value)) {
    throw new Error(`${label} must be a safe identifier no longer than ${maxPrincipalIdLength} characters`);
  }
}
