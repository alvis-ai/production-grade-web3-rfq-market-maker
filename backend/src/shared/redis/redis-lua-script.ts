import { createHash } from "node:crypto";

export interface RedisLuaClient {
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
  evalsha?(sha1: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export class RedisLuaScript {
  readonly sha1: string;

  constructor(readonly source: string) {
    if (typeof source !== "string" || source.length === 0) {
      throw new Error("Redis Lua script source must be a non-empty string");
    }
    this.sha1 = createHash("sha1").update(source).digest("hex");
  }

  async execute(
    client: RedisLuaClient,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown> {
    if (!Number.isSafeInteger(numberOfKeys) || numberOfKeys < 0 || numberOfKeys > args.length) {
      throw new Error("Redis Lua script key count is invalid");
    }
    if (typeof client.evalsha !== "function") {
      return client.eval(this.source, numberOfKeys, ...args);
    }
    try {
      return await client.evalsha(this.sha1, numberOfKeys, ...args);
    } catch (error) {
      if (!isNoScriptError(error)) throw error;
      return client.eval(this.source, numberOfKeys, ...args);
    }
  }
}

function isNoScriptError(error: unknown): boolean {
  return error instanceof Error && /^NOSCRIPT(?:\s|$)/.test(error.message);
}
