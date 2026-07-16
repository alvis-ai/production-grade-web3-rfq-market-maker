import { TextDecoder } from "node:util";
import { APIError } from "../../shared/errors/api-error.js";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";

export const defaultPnlPageLimit = 50;
export const maxPnlPageLimit = 100;

const cursorPrefix = "pnl1_";
const maxCursorLength = 512;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const cursorFields = ["version", "asOf", "realizedAt", "pnlId"] as const;

export interface PnlCursor {
  version: 1;
  asOf: string;
  realizedAt: string;
  pnlId: string;
}

export interface PnlPageRequest {
  limit: number;
  cursor?: PnlCursor;
}

export function parsePnlPageQuery(query: unknown): PnlPageRequest {
  if (!isRecord(query)) throw invalidRequest("PnL query must be an object");
  const fields = Object.keys(query);
  if (fields.some((field) => field !== "limit" && field !== "cursor")) {
    throw invalidRequest("PnL query contains an unsupported parameter");
  }

  const rawLimit = Object.prototype.hasOwnProperty.call(query, "limit") ? query.limit : undefined;
  const limit = rawLimit === undefined ? defaultPnlPageLimit : parseLimit(rawLimit);
  const rawCursor = Object.prototype.hasOwnProperty.call(query, "cursor") ? query.cursor : undefined;
  return {
    limit,
    ...(rawCursor === undefined ? {} : { cursor: decodePnlCursor(rawCursor) }),
  };
}

export function assertPnlPageRequest(request: unknown): asserts request is PnlPageRequest {
  if (!isRecord(request)) throw new Error("PnL page request must be an object");
  const fields = Object.keys(request);
  if (!Object.prototype.hasOwnProperty.call(request, "limit") ||
      ("cursor" in request && !Object.prototype.hasOwnProperty.call(request, "cursor")) ||
      fields.some((field) => field !== "limit" && field !== "cursor") ||
      !Number.isSafeInteger(request.limit) || Number(request.limit) < 1 || Number(request.limit) > maxPnlPageLimit) {
    throw new Error(`PnL page limit must be an integer between 1 and ${maxPnlPageLimit}`);
  }
  if (request.cursor !== undefined) assertCursor(request.cursor, "PnL page cursor");
}

export function encodePnlCursor(input: Omit<PnlCursor, "version">): string {
  const cursor: PnlCursor = { version: 1, ...input };
  assertCursor(cursor, "PnL cursor");
  return `${cursorPrefix}${Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")}`;
}

export function comparePnlPositionDescending(
  left: Pick<PnlCursor, "realizedAt" | "pnlId">,
  right: Pick<PnlCursor, "realizedAt" | "pnlId">,
): number {
  return right.realizedAt.localeCompare(left.realizedAt) || right.pnlId.localeCompare(left.pnlId);
}

export function isAfterPnlCursor(
  value: Pick<PnlCursor, "realizedAt" | "pnlId">,
  cursor: PnlCursor,
): boolean {
  return value.realizedAt < cursor.realizedAt ||
    (value.realizedAt === cursor.realizedAt && value.pnlId < cursor.pnlId);
}

function decodePnlCursor(value: unknown): PnlCursor {
  if (typeof value !== "string" || value.length <= cursorPrefix.length || value.length > maxCursorLength ||
      !value.startsWith(cursorPrefix)) {
    throw invalidRequest("PnL cursor is invalid");
  }
  const encoded = value.slice(cursorPrefix.length);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw invalidRequest("PnL cursor is invalid");

  let decoded: unknown;
  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.length === 0 || bytes.toString("base64url") !== encoded) throw new Error("non-canonical base64url");
    const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    decoded = JSON.parse(json);
  } catch {
    throw invalidRequest("PnL cursor is invalid");
  }

  try {
    assertCursor(decoded, "PnL cursor");
  } catch {
    throw invalidRequest("PnL cursor is invalid");
  }
  return decoded;
}

function parseLimit(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,2}$/.test(value)) {
    throw invalidRequest(`PnL limit must be an integer between 1 and ${maxPnlPageLimit}`);
  }
  const limit = Number(value);
  if (limit > maxPnlPageLimit) {
    throw invalidRequest(`PnL limit must be an integer between 1 and ${maxPnlPageLimit}`);
  }
  return limit;
}

function assertCursor(value: unknown, label: string): asserts value is PnlCursor {
  if (!isRecord(value) || Object.keys(value).length !== cursorFields.length ||
      cursorFields.some((field) => !Object.prototype.hasOwnProperty.call(value, field)) || value.version !== 1 ||
      !isCanonicalUtcIsoTimestamp(value.asOf) || !isCanonicalUtcIsoTimestamp(value.realizedAt) ||
      typeof value.pnlId !== "string" || value.pnlId.length === 0 || value.pnlId.length > 128 ||
      !safeIdentifierPattern.test(value.pnlId)) {
    throw new Error(`${label} is invalid`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidRequest(message: string): APIError {
  return new APIError("INVALID_REQUEST", message, 400);
}
