import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse, stringify } from "yaml";
import { prepareCompose } from "../src/lib/runtime";

for (const kind of ["kong", "envoy"]) {
  const upstream = parse(readFileSync(new URL(`./fixtures/${kind}-compose.yml`, import.meta.url), "utf8"));
  // The trimmed fixtures lack auth (GoTrue); inject it with its real upstream healthcheck, plus a service with no healthcheck.
  upstream.services.auth = {
    image: "supabase/gotrue:v2.186.0",
    healthcheck: { test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:9999/health"], timeout: "5s", interval: "5s", retries: 3 },
  };
  upstream.services.nohc = { image: "busybox" };
  const out = parse(prepareCompose(stringify(upstream), "fixture", true)).services;

  test(`${kind}: services with a healthcheck and no start_period get one`, () => {
    for (const name of ["auth", "db"]) {
      assert.ok(upstream.services[name].healthcheck.test, `${name} has a healthcheck test`);
      assert.equal(upstream.services[name].healthcheck.start_period, undefined, `${name} had none upstream`);
      assert.equal(out[name].healthcheck.start_period, "120s");
      assert.equal(out[name].healthcheck.start_interval, "2s");
    }
  });

  test(`${kind}: existing start_period is kept; no healthcheck is not invented`, () => {
    assert.equal(upstream.services.studio.healthcheck.start_period, "20s");
    assert.equal(out.studio.healthcheck.start_period, "20s");
    assert.equal(out.nohc.healthcheck, undefined);
  });
}
