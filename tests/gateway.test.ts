import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse, stringify } from "yaml";
import { prepareCompose, routeCompose } from "../src/lib/runtime";
import { getProjectPorts } from "../src/lib/traefik";

let originalEnv: NodeJS.ProcessEnv;
beforeEach(() => { originalEnv = { ...process.env }; });
afterEach(() => { process.env = originalEnv; });

// SHA-256 of prepareCompose (re-pinned when healthchecks gained start_period; previously pre-fix) output from the real, trimmed Kong fixture.
const kongBaseline: Record<string, string> = {"dokploy": "5f9f9342f92fa7ff061e4b2c44873b39b1320aa29e308c42822d77b339e975ae", "production": "f60de5d10b642661ba8645c77b1365c9e125e7ad53f89e3cc4777484ed408841", "development": "79a1ac72f7ba0e14d36c1a09d187e3a1d9b685a0ed2355ff33aaeeab2e55cb22"};

for (const kind of ["kong", "envoy"]) {
  const source = readFileSync(new URL(`./fixtures/${kind}-compose.yml`, import.meta.url), "utf8");
  const upstream = parse(source);
  const name = kind === "kong" ? "kong" : "api-gw";
  for (const mode of ["dokploy", "production", "development"]) {
    test(`${kind}: ${mode} preserves upstream gateway and isolates proxy access`, () => {
      process.env.SUPAPANEL_MODE = mode;
      process.env.PROXY_NETWORK = "test-proxy";
      const prepared = prepareCompose(source, "fixture", mode === "dokploy");
      if (kind === "kong") assert.equal(createHash("sha256").update(prepared).digest("hex"), kongBaseline[mode]);
      const result = parse(prepared);
      const gateway = result.services[name];
      const proxy = mode !== "development";
      assert.equal(gateway.container_name, `fixture-${name}`);
      assert.deepEqual(gateway.networks.default, upstream.services[name].networks.default);
      assert.deepEqual(gateway.networks.proxy, proxy ? (kind === "envoy" ? { aliases: ["fixture-kong"] } : {}) : undefined);
      for (const field of ["image", "environment", "entrypoint", "volumes", "healthcheck", "depends_on"]) {
        // Healthchecks only gain the first-boot start_period/start_interval (see healthcheck.test.ts).
        const expected = field === "healthcheck" ? { start_period: "120s", start_interval: "2s", ...upstream.services[name][field] } : upstream.services[name][field];
        assert.deepEqual(gateway[field], expected, field);
      }
      assert.deepEqual(gateway.ports, mode === "dokploy" ? undefined : upstream.services[name].ports);
      for (const [service, config] of Object.entries(result.services) as [string, { networks: object; labels?: unknown; ports?: unknown }][]) {
        if (service !== name) {
          assert.deepEqual(Object.keys(config.networks), ["default"]);
          assert.equal(config.labels, undefined);
        }
        if (mode === "dokploy") assert.equal(config.ports, undefined);
      }
      assert.equal(result.services.realtime.container_name, "realtime-dev.fixture-realtime");
      if (kind === "envoy") {
        // Upstream volumes/api/envoy/cds.yaml addresses this exact hostname.
        assert.ok(result.services.realtime.networks.default.aliases.includes("realtime-dev.supabase-realtime"));
      } else {
        assert.deepEqual(result.services.realtime.networks.default, {});
      }
      assert.deepEqual(result.services.functions.depends_on, upstream.services.functions.depends_on);
      assert.deepEqual(result.services.studio.environment, upstream.services.studio.environment);
    });
  }
  test(`${kind}: API and Studio labels go through gateway auth, including clearing routes`, () => {
    process.env.PROXY_NETWORK = "test-proxy";
    // Test routing independently of preparation, as with an existing project.
    const result = parse(routeCompose(source, "fixture", "api.example.com", "studio.example.com"));
    const labels = result.services[name].labels;
    for (const route of ["api", "studio"]) {
      assert.equal(labels[`traefik.http.services.fixture-${route}.loadbalancer.server.port`], "8000");
      assert.equal(labels[`traefik.http.routers.fixture-${route}.rule`], `Host(\`${route}.example.com\`)`);
    }
    assert.equal(labels["traefik.docker.network"], "test-proxy");
    assert.equal(result.services.studio.labels, undefined);
    const cleared = parse(routeCompose(stringify(result), "fixture", "", ""));
    assert.equal(cleared.services[name].labels["traefik.enable"], "false");
    assert.equal(cleared.services[name].labels["traefik.http.routers.fixture-api.rule"], undefined);
  });
}

test("api-gw takes precedence over a legacy kong service", () => {
  const source = readFileSync(new URL("./fixtures/envoy-compose.yml", import.meta.url), "utf8");
  const compose = parse(source);
  compose.services.kong = { image: "kong/kong:3.9.3" };
  const result = parse(prepareCompose(stringify(compose), "both", true));
  assert.deepEqual(result.services["api-gw"].networks.proxy, { aliases: ["both-kong"] });
  assert.equal(result.services.kong.networks.proxy, undefined);
  const routed = parse(routeCompose(stringify(result), "both", "api.example.com", ""));
  assert.equal(routed.services["api-gw"].labels["traefik.enable"], "true");
  assert.equal(routed.services.kong.labels, undefined);
});

test("gateway host port prefers API_GW_HTTP_PORT with legacy and empty fallbacks", () => {
  assert.equal(getProjectPorts({ API_GW_HTTP_PORT: "9000", KONG_HTTP_PORT: "8001" }).kongPort, 9000);
  assert.equal(getProjectPorts({ KONG_HTTP_PORT: "8001" }).kongPort, 8001);
  assert.equal(getProjectPorts({ API_GW_HTTP_PORT: "", KONG_HTTP_PORT: "8001" }).kongPort, 8001);
  assert.equal(getProjectPorts({}).kongPort, 8000);
});
