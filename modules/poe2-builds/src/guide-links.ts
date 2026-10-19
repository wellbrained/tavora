interface Reader { id: string; build: string; usedAt: number }
export function chooseReader(readers: Reader[], build: string): Reader | undefined {
    return readers.filter(r => r.build === build).sort((a, b) => b.usedAt - a.usedAt || b.id.localeCompare(a.id))[0];
}

/** Section messages stay inside this module's local browser partition. Build IDs
 * remain unchanged so the host can reuse an existing panel for that build.
 * Mirror its most-recently-used selection when several Guide copies are open. */
export class GuideLinks {
    private channel = new BroadcastChannel('poe2-builds-guide-links-v1');
    private id = crypto.randomUUID();
    private usedAt = Date.now();
    private pending: { nonce: string; build: string; section: number; readers: Map<string, Reader>; resolve: (ok: boolean) => void } | null = null;
    private timers = new Set<ReturnType<typeof setTimeout>>();
    private touch = () => { this.usedAt = Date.now(); };
    constructor(private reader: () => { build: string | null; ready: boolean }, private jump: (section: number) => void) {
        addEventListener('pointerdown', this.touch, true);
        addEventListener('keydown', this.touch, true);
        this.channel.onmessage = event => {
            const m = event.data;
            if (!m || typeof m !== 'object') return;
            if (m.type === 'probe' && typeof m.nonce === 'string') {
                const current = this.reader();
                if (current.ready && current.build === m.build) this.channel.postMessage({ type: 'reader', nonce: m.nonce, id: this.id, build: current.build, usedAt: this.usedAt });
            } else if (m.type === 'reader' && this.pending && this.pending.nonce === m.nonce && typeof m.id === 'string' && typeof m.build === 'string' && Number.isFinite(m.usedAt)) {
                this.pending.readers.set(m.id, m as Reader);
            } else if (m.type === 'jump' && m.id === this.id && this.reader().build === m.build && Number.isSafeInteger(m.section) && m.section >= 0) {
                this.touch(); this.jump(m.section);
                this.channel.postMessage({ type: 'ack', nonce: m.nonce });
            } else if (m.type === 'ack' && this.pending?.nonce === m.nonce) this.finish(true);
        };
    }
    private later(fn: () => void, delay: number) { const timer = setTimeout(() => { this.timers.delete(timer); fn(); }, delay); this.timers.add(timer); }
    private finish(ok: boolean) { const pending = this.pending; this.pending = null; for (const timer of this.timers) clearTimeout(timer); this.timers.clear(); pending?.resolve(ok); }
    /** Call after panels.open resolves; a newly created Guide may still be loading. */
    navigate(build: string, section: number): Promise<boolean> {
        this.finish(false);
        return new Promise(resolve => {
            const pending = this.pending = { nonce: crypto.randomUUID(), build, section, readers: new Map<string, Reader>(), resolve };
            const probe = () => {
                this.channel.postMessage({ type: 'probe', nonce: pending.nonce, build });
                this.later(() => {
                    if (this.pending !== pending) return;
                    const target = chooseReader([...pending.readers.values()], build);
                    if (target) this.channel.postMessage({ type: 'jump', nonce: pending.nonce, id: target.id, build, section });
                    else probe();
                }, 200);
            };
            probe(); this.later(() => this.finish(false), 6000);
        });
    }
    destroy() { this.finish(false); this.channel.close(); removeEventListener('pointerdown', this.touch, true); removeEventListener('keydown', this.touch, true); }
}
