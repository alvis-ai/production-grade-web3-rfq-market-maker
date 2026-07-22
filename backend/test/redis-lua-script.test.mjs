import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { RedisLuaScript } from "../dist/shared/redis/redis-lua-script.js";

const source = 'return redis.call("GET", KEYS[1])';

test("RedisLuaScript uses SHA1 execution on the steady-state path", async () => {
  const calls = [];
  const script = new RedisLuaScript(source);
  const result = await script.execute({
    async eval() { assert.fail("steady-state execution must not send script source"); },
    async evalsha(...args) {
      calls.push(args);
      return "value";
    },
  }, 1, "rfq:{test}:key");

  assert.equal(result, "value");
  assert.equal(script.sha1, createHash("sha1").update(source).digest("hex"));
  assert.deepEqual(calls, [[script.sha1, 1, "rfq:{test}:key"]]);
});

test("RedisLuaScript falls back only for an exact Redis NOSCRIPT response", async () => {
  const calls = [];
  const script = new RedisLuaScript(source);
  const client = {
    async eval(...args) {
      calls.push(["eval", ...args]);
      return "loaded";
    },
    async evalsha(...args) {
      calls.push(["evalsha", ...args]);
      throw new Error("NOSCRIPT No matching script. Please use EVAL.");
    },
  };

  assert.equal(await script.execute(client, 1, "rfq:{test}:key"), "loaded");
  assert.deepEqual(calls, [
    ["evalsha", script.sha1, 1, "rfq:{test}:key"],
    ["eval", source, 1, "rfq:{test}:key"],
  ]);

  await assert.rejects(
    script.execute({
      async eval() { assert.fail("non-NOSCRIPT errors must not execute source"); },
      async evalsha() { throw new Error("READONLY replica"); },
    }, 1, "rfq:{test}:key"),
    /READONLY replica/,
  );
});

test("RedisLuaScript preserves legacy eval-only clients and validates key counts", async () => {
  const script = new RedisLuaScript(source);
  assert.equal(await script.execute({
    async eval(scriptSource, numberOfKeys, key) {
      assert.equal(scriptSource, source);
      assert.equal(numberOfKeys, 1);
      assert.equal(key, "rfq:{test}:key");
      return "legacy";
    },
  }, 1, "rfq:{test}:key"), "legacy");
  await assert.rejects(script.execute({ async eval() {} }, 2, "one"), /key count/);
  assert.throws(() => new RedisLuaScript(""), /non-empty string/);
});
