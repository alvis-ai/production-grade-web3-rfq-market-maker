import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import {
  assertDatabaseUrlForEnvironment,
  connectionString,
  readDatabaseConfig,
} from "../dist/db/config.js";

test("database config preserves verified TLS and bounded pool settings", () => {
  const config = readDatabaseConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://user:p%40ss@db.example.com:5433/market%20maker" +
      "?minPool=3&maxPool=20&sslmode=verify-full&sslrootcert=%2Fetc%2Fssl%2Frds-ca.pem",
  });

  assert.deepEqual(config, {
    host: "db.example.com",
    port: 5433,
    database: "market maker",
    user: "user",
    password: "p@ss",
    minPoolSize: 3,
    maxPoolSize: 20,
    sslMode: "verify-full",
    sslRootCertPath: "/etc/ssl/rds-ca.pem",
  });
  assert.equal(
    connectionString(config),
    "postgres://user:p%40ss@db.example.com:5433/market%20maker" +
      "?sslmode=verify-full&sslrootcert=%2Fetc%2Fssl%2Frds-ca.pem",
  );
});

test("database config permits explicit plaintext only in local environments", () => {
  const config = readDatabaseConfig({
    NODE_ENV: "development",
    DATABASE_URL: "postgres://rfq:rfq@127.0.0.1:5432/rfq?sslmode=disable",
  });
  assert.equal(config.sslMode, "disable");
  assert.equal(connectionString(config), "postgres://rfq:rfq@127.0.0.1:5432/rfq");

  const inherited = Object.create({ NODE_ENV: "production" });
  inherited.DATABASE_URL = "postgres://rfq:rfq@127.0.0.1:5432/rfq";
  assert.equal(readDatabaseConfig(inherited).sslMode, "disable");
});

test("database config requires hostname-verified TLS outside local environments", () => {
  for (const nodeEnv of ["production", "staging"]) {
    for (const url of [
      "postgres://user:secret@db.example.com/rfq",
      "postgres://user:secret@db.example.com/rfq?sslmode=disable",
    ]) {
      assert.throws(
        () => assertDatabaseUrlForEnvironment(url, nodeEnv),
        /sslmode=verify-full/,
      );
    }
  }

  const secureUrl = "postgres://user:secret@db.example.com/rfq?sslmode=verify-full";
  assert.doesNotThrow(() => assertDatabaseUrlForEnvironment(secureUrl, "production"));
  const client = new pg.Client({ connectionString: secureUrl });
  assert.deepEqual(client.connectionParameters.ssl, {});
});

test("database config rejects ambiguous or downgrade-prone TLS parameters", () => {
  for (const url of [
    "postgres://db/rfq?sslmode=require",
    "postgres://db/rfq?sslmode=verify-ca",
    "postgres://db/rfq?sslmode=no-verify",
    "postgres://db/rfq?sslmode=verify-full&sslmode=disable",
    "postgres://db/rfq?sslrootcert=relative.pem",
    "postgres://db/rfq?sslmode=disable&sslrootcert=%2Fca.pem",
    "postgres://db/rfq?application_name=rfq",
    "postgres:///rfq?sslmode=verify-full",
    "postgres://db/rfq#fragment",
  ]) {
    assert.throws(() => assertDatabaseUrlForEnvironment(url, "development"), /DATABASE_URL/);
  }
});
