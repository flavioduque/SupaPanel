import test from "node:test";
import assert from "node:assert/strict";
import {
  networkRate,
  parseNetDev,
  readMemory,
  readNetwork,
} from "../src/lib/host-metrics";

// Fake filesystem: path -> content. Missing path = file not mounted.
const reader = (files: Record<string, string>) => (path: string) =>
  path in files ? files[path] : null;

const MEMINFO = `MemTotal:        4194304 kB
MemFree:         3000000 kB
MemAvailable:    3500000 kB
`;
// inactive_file = 512 MiB
const MEMORY_STAT = `anon 1000000000
file 1100000000
active_file 563000000
inactive_file 536870912
`;

const NET_DEV = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 999999       10    0    0    0     0          0         0   999999      10    0    0    0     0       0          0
  eth0: 7400000000 5000000    0    0    0     0          0         0 1200000000 3000000    0    0    0     0       0          0
docker0: 5555555     100    0    0    0     0          0         0  4444444     100    0    0    0     0       0          0
br-3f2a1b: 333333     100    0    0    0     0          0         0   222222     100    0    0    0     0       0          0
veth12ab: 111111      50    0    0    0     0          0         0    77777      50    0    0    0     0       0          0
 ens19:     100       1    0    0    0     0          0         0       50       1    0    0    0     0       0          0
`;

test("memory with host cgroup mounts uses the LXC working set, not the host total", () => {
  const mem = readMemory(
    reader({
      "/host/cgroup/memory.current": "2188431360\n",
      "/host/cgroup/memory.max": "max\n",
      "/host/cgroup/memory.stat": MEMORY_STAT,
      "/host/proc/meminfo": MEMINFO,
    }),
    { total: 16642998272, free: 1000 },
  );
  // 2188431360 - 536870912 = 1651560448 ; 4194304 kB * 1024 = 4294967296 ; 38.45% -> 38
  assert.deepEqual(mem, { used: 1651560448, total: 4294967296, percentage: 38 });
});

test("memory uses a numeric memory.max as total", () => {
  const mem = readMemory(
    reader({
      "/host/cgroup/memory.current": "2188431360",
      "/host/cgroup/memory.max": "8589934592",
      "/host/cgroup/memory.stat": MEMORY_STAT,
      "/host/proc/meminfo": MEMINFO,
    }),
    { total: 16642998272, free: 1000 },
  );
  // 1651560448 / 8589934592 = 19.2% -> 19
  assert.deepEqual(mem, { used: 1651560448, total: 8589934592, percentage: 19 });
});

test("memory without mounts keeps the os-based behaviour", () => {
  const mem = readMemory(reader({}), { total: 8000, free: 2000 });
  assert.deepEqual(mem, { used: 6000, total: 8000, percentage: 75 });
});

test("net/dev parsing sums physical interfaces and skips lo/docker/br/veth", () => {
  // eth0 + ens19 only: 7400000000 + 100 ; 1200000000 + 50
  assert.deepEqual(parseNetDev(NET_DEV), { bytesIn: 7400000100, bytesOut: 1200000050 });
});

test("network prefers the host's net/dev (PID 1 namespace) when mounted", () => {
  const container = `Inter-| x\n face | y\n  eth0: 4242 1 0 0 0 0 0 0 2121 1 0 0 0 0 0 0\n`;
  assert.deepEqual(
    readNetwork(reader({ "/host/proc/1/net/dev": NET_DEV, "/proc/net/dev": container })),
    { bytesIn: 7400000100, bytesOut: 1200000050 },
  );
  // Without the mount, the container's own counters are used as before.
  assert.deepEqual(readNetwork(reader({ "/proc/net/dev": container })), { bytesIn: 4242, bytesOut: 2121 });
  assert.equal(readNetwork(reader({})), null);
});

test("network rate: first sample is 0, two samples give bytes per second", () => {
  const first = { bytesIn: 1000, bytesOut: 500, at: 10_000 };
  assert.deepEqual(networkRate(null, first), { inPerSec: 0, outPerSec: 0 });
  const second = { bytesIn: 61000, bytesOut: 15500, at: 15_000 };
  // (61000-1000)/5s = 12000 ; (15500-500)/5s = 3000
  assert.deepEqual(networkRate(first, second), { inPerSec: 12000, outPerSec: 3000 });
  // Counter reset (interface restarted) never yields a negative rate.
  assert.deepEqual(networkRate(second, { bytesIn: 10, bytesOut: 10, at: 20_000 }), { inPerSec: 0, outPerSec: 0 });
});
