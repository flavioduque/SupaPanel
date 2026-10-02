// Host-scope memory and network metrics. The panel runs in a container, so
// os.totalmem() and /proc/net/dev describe the wrong scope. With the read-only
// mounts /proc:/host/proc and /sys/fs/cgroup:/host/cgroup we read the machine
// (or LXC/VM) instead. All I/O goes through `read`, so tests use a fake fs.

export type Read = (path: string) => string | null

export interface MemoryUsage { used: number; total: number; percentage: number }
export interface NetworkTotals { bytesIn: number; bytesOut: number }
export interface NetworkSample extends NetworkTotals { at: number }

const hostProc = () => process.env.HOST_PROC || '/host/proc'
const hostCgroup = () => process.env.HOST_CGROUP || '/host/cgroup'

function statField(text: string, key: string): number | null {
    const m = text.match(new RegExp(`^${key}\\s+(\\d+)`, 'm'))
    return m ? Number(m[1]) : null
}

function memTotal(meminfo: string): number | null {
    const m = meminfo.match(/^MemTotal:\s+(\d+)\s+kB/m)
    return m ? Number(m[1]) * 1024 : null
}

function usage(used: number, total: number): MemoryUsage {
    return { used, total, percentage: Math.round((used / total) * 100) }
}

// cgroup v2 working set (memory.current - inactive_file), as cAdvisor and
// `docker stats` compute it. MemFree/MemAvailable from lxcfs are computed for
// the reader's cgroup, so only MemTotal is trusted from meminfo.
export function readMemory(read: Read, os: { total: number; free: number }): MemoryUsage {
    const current = Number(read(`${hostCgroup()}/memory.current`)?.trim() || NaN)
    if (Number.isFinite(current)) {
        const inactive = statField(read(`${hostCgroup()}/memory.stat`) ?? '', 'inactive_file') ?? 0
        const max = Number(read(`${hostCgroup()}/memory.max`)?.trim() || NaN)
        const total = Number.isFinite(max)
            ? max
            : memTotal(read(`${hostProc()}/meminfo`) ?? '') ?? os.total
        return usage(Math.max(0, current - inactive), total)
    }
    return usage(os.total - os.free, os.total)
}

// Virtual interfaces whose traffic is already counted on a physical one.
const VIRTUAL = /^(lo|docker|br-|veth|virbr|vnet|tun|tap|wg|tailscale|zt|cni|flannel|cali|vxlan|kube|dummy|ifb)/

export function parseNetDev(text: string): NetworkTotals {
    let bytesIn = 0
    let bytesOut = 0
    for (const line of text.split('\n')) {
        const m = line.match(/^\s*([^\s:]+):\s*(.*)$/)
        if (!m || VIRTUAL.test(m[1])) continue
        const f = m[2].trim().split(/\s+/)
        bytesIn += Number(f[0]) || 0
        bytesOut += Number(f[8]) || 0
    }
    return { bytesIn, bytesOut }
}

// /proc/net/dev is per network namespace; PID 1 of the host proc is in the
// machine's namespace. Without the mount, fall back to the container's own.
export function readNetwork(read: Read): NetworkTotals | null {
    const text = read(`${hostProc()}/1/net/dev`) ?? read('/proc/net/dev')
    return text === null ? null : parseNetDev(text)
}

export function networkRate(prev: NetworkSample | null, curr: NetworkSample) {
    const secs = prev ? (curr.at - prev.at) / 1000 : 0
    if (!prev || secs <= 0) return { inPerSec: 0, outPerSec: 0 }
    const rate = (a: number, b: number) => (b >= a ? Math.round((b - a) / secs) : 0)
    return { inPerSec: rate(prev.bytesIn, curr.bytesIn), outPerSec: rate(prev.bytesOut, curr.bytesOut) }
}
