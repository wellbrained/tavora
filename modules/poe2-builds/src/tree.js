import { treeArtwork } from './tree-art';
import { t } from './i18n';

export function createTree(canvas, context, options = {}) {
    const { state, nodesFor, selectedStage, selectedBuild, ascendancyName, esc } = context;
    class PassiveTree {
        constructor(canvas, options = {}) { this.ascendancy = !!options.ascendancy; this.compact = !!options.compact; this.tooltip = canvas.closest('.tree-body').querySelector('.node-tooltip'); this.canvas = canvas; this.ctx = canvas.getContext('2d'); const style = getComputedStyle(canvas); this.palette = { 1: style.getPropertyValue('--weapon-set-1').trim(), 2: style.getPropertyValue('--weapon-set-2').trim(), shared: style.getPropertyValue('--passive-shared').trim() }; this.nodes = nodesFor(); this.byId = new Map(this.nodes.map(n => [n.id, n])); this.atlas = new Image(); this.atlas.src = new URL('assets/passives.webp', document.baseURI).href; this.atlas.onload = () => this.draw(); this.selected = new Map(selectedStage('tree').passives.map(p => [p.id, p.weapon])); this.previous = new Set((selectedBuild('tree').stages[state.tree - 1]?.passives || []).map(p => p.id)); this.observer = new ResizeObserver(() => { this.resize(); this.fit(true); this.initial = true; }); this.observer.observe(canvas.parentElement); this.artwork = treeArtwork(selectedBuild().treeVersion, ascendancyName(), this.ascendancy); this.illustration = this.artwork ? this.loadImage('assets/classes/' + this.artwork.file) : null; this.frames = {}; for (const kind of ['Small', 'Notable', 'Keystone']) for (const status of ['Normal', 'Active']) this.frames[kind + status] = this.loadImage(`assets/frames/${kind}-${status}.webp`); this.bind(); }
        loadImage(path) { const img = new Image(); img.onload = () => this.draw(); img.src = new URL(path, document.baseURI).href; return img; }
        destroy() { this.observer.disconnect(); this.atlas.onload = null; if (this.illustration) this.illustration.onload = null; for (const image of Object.values(this.frames)) image.onload = null; }
        visibleNodes() { return this.nodes.filter(n => this.ascendancy ? n.ascendancy === ascendancyName() : !n.ascendancy); }
        eligible(n) { return this.selected.has(n.id) && (state.weapon === 'all' || !this.selected.get(n.id) || String(this.selected.get(n.id)) === state.weapon); }
        resize() { const r = this.canvas.getBoundingClientRect(); this.width = r.width; this.height = r.height; const dpr = devicePixelRatio || 1; this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr); this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
        fit(build) { let ns = this.visibleNodes(); if (build)
            ns = ns.filter(n => this.selected.has(n.id)); if (!ns.length)
            return; const xs = ns.map(n => n.x), ys = ns.map(n => n.y); if (this.ascendancy && this.artwork) { const a = this.artwork; xs.push(a.x - a.width, a.x + a.width); ys.push(a.y - a.height, a.y + a.height); } const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys); this.scale = Math.min((this.width - (this.compact ? 50 : 100)) / Math.max(maxX - minX, 700), (this.height - (this.compact ? 50 : 155)) / Math.max(maxY - minY, 700)); this.scale = Math.max(.008, Math.min(this.scale, .5)); this.tx = this.width / 2 - (minX + maxX) / 2 * this.scale; this.ty = (this.height - 15) / 2 - (minY + maxY) / 2 * this.scale; this.hideTooltip(); this.draw(); }
        center(n) { this.scale = Math.max(this.scale, .24); this.tx = this.width / 2 - n.x * this.scale; this.ty = this.height / 2 - n.y * this.scale; this.draw(); }
        zoom(factor, x = this.width / 2, y = this.height / 2) { const next = Math.min(1.1, Math.max(.008, this.scale * factor)); const f = next / this.scale; this.tx = x - (x - this.tx) * f; this.ty = y - (y - this.ty) * f; this.scale = next; this.hideTooltip(); this.draw(); }
        point(n) { return { x: n.x * this.scale + this.tx, y: n.y * this.scale + this.ty }; }
        color(n) { return this.palette[this.selected.get(n.id) || 'shared']; }
        draw() {
            if (!this.scale)
                return;
            const c = this.ctx;
            c.clearRect(0, 0, this.width, this.height);
            if (this.artwork && this.illustration?.complete && this.illustration.naturalWidth) {
                const a = this.artwork, p = this.point(a);
                // PoB's DrawAsset treats background width/height as half extents.
                c.globalAlpha = .7;
                c.drawImage(this.illustration, p.x - a.width * this.scale, p.y - a.height * this.scale, a.width * 2 * this.scale, a.height * 2 * this.scale);
                c.globalAlpha = 1;
            }
            const nodes = this.visibleNodes(), visible = new Set(nodes.map(n => n.id));
            const search = this.ascendancy ? '' : state.search.toLowerCase();
            const edgeDone = new Set();
            for (const n of nodes) {
                for (const id of n.links) {
                    if (!visible.has(id))
                        continue;
                    const key = [n.id, id].sort().join('-');
                    if (edgeDone.has(key))
                        continue;
                    edgeDone.add(key);
                    const other = this.byId.get(id);
                    if (!other)
                        continue;
                    const a = this.point(n), b = this.point(other);
                    if (Math.max(a.x, b.x) < -50 || Math.min(a.x, b.x) > this.width + 50 || Math.max(a.y, b.y) < -50 || Math.min(a.y, b.y) > this.height + 50)
                        continue;
                    const w1 = this.selected.get(n.id), w2 = this.selected.get(other.id);
                    const active = this.eligible(n) && this.eligible(other) && (!w1 || !w2 || w1 === w2);
                    c.strokeStyle = active ? this.palette[w1 || w2 || 'shared'] : '#393c3a';
                    c.globalAlpha = active ? 1 : .6;
                    c.lineWidth = active ? Math.max(1.8, this.scale * 9) : Math.max(.65, this.scale * 3);
                    c.beginPath();
                    if (n.group === other.group && n.orbit === other.orbit && n.radius > 0) {
                        const g = { x: n.gx * this.scale + this.tx, y: n.gy * this.scale + this.ty };
                        let a1 = n.angle - Math.PI / 2, a2 = other.angle - Math.PI / 2;
                        let delta = ((a2 - a1 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
                        c.arc(g.x, g.y, n.radius * this.scale, a1, a1 + delta, delta < 0);
                    }
                    else {
                        c.moveTo(a.x, a.y);
                        c.lineTo(b.x, b.y);
                    }
                    c.stroke();
                }
            }
            c.globalAlpha = 1;
            for (const n of [...nodes].sort((a, b) => Number(this.eligible(a)) - Number(this.eligible(b)))) {
                const p = this.point(n);
                if (p.x < -30 || p.y < -30 || p.x > this.width + 30 || p.y > this.height + 30)
                    continue;
                const active = this.eligible(n), match = search && n.name.toLowerCase().includes(search), isNew = active && !this.previous.has(n.id);
                const r = Math.max(active ? (n.notable ? 4 : 2.8) : .8, Math.min(n.keystone ? 24 : n.notable ? 19 : 12, (n.keystone ? 72 : n.notable ? 57 : 32) * this.scale));
                c.globalAlpha = search && !match ? .24 : state.changes && active && !isNew ? .4 : active ? 1 : .23;
                c.beginPath();
                c.arc(p.x, p.y, r + 1.5, 0, Math.PI * 2);
                c.fillStyle = active ? '#28251d' : '#131719';
                c.fill();
                if (n.icon && this.atlas.complete && this.atlas.naturalWidth) {
                    c.save();
                    c.beginPath();
                    c.arc(p.x, p.y, r, 0, Math.PI * 2);
                    c.clip();
                    c.drawImage(this.atlas, n.icon[0], n.icon[1], 64, 64, p.x - r, p.y - r, r * 2, r * 2);
                    c.restore();
                }
                c.beginPath();
                c.arc(p.x, p.y, r + 1, 0, Math.PI * 2);
                if (context.decorativeFrames?.()) {
                    const frame = this.frames[(n.keystone ? 'Keystone' : n.notable ? 'Notable' : 'Small') + (active ? 'Active' : 'Normal')];
                    if (frame?.complete && frame.naturalWidth) {
                        const size = r * (n.keystone ? 3.2 : n.notable ? 3 : 2.8);
                        c.drawImage(frame, p.x - size / 2, p.y - size / 2, size, size);
                    }
                }
                // Keep the allocation ring, including both weapon-set colours, over the artwork.
                c.beginPath(); c.arc(p.x, p.y, r + 1, 0, Math.PI * 2);
                c.strokeStyle = match ? '#f6f1c3' : active ? this.color(n) : n.notable ? '#79674c' : '#55554b';
                c.lineWidth = active ? 1.8 : 1;
                c.stroke();
                if (match || (state.changes && isNew)) {
                    c.beginPath();
                    c.arc(p.x, p.y, r + 5, 0, Math.PI * 2);
                    c.strokeStyle = match ? '#f6f1c3' : '#9bd5e4';
                    c.lineWidth = 1.3;
                    c.stroke();
                }
                if (n === this.hover) {
                    c.beginPath();
                    c.arc(p.x, p.y, r + 5, 0, Math.PI * 2);
                    c.strokeStyle = '#f2e8d1';
                    c.stroke();
                }
                if (context.nodeNames?.() !== false && (n.notable || n.keystone) && active && this.scale > .075) {
                    c.font = '12px "Segoe UI",sans-serif';
                    c.textAlign = 'center';
                    c.fillStyle = '#e3d6b9';
                    c.globalAlpha = 1;
                    c.fillText(n.name, p.x, p.y + r + 17);
                }
            }
            c.globalAlpha = 1;
            const total = this.visibleNodes().filter(n => this.eligible(n)).length;
            if (!total) {
                c.fillStyle = '#b8b0a4';
                c.font = '14px "Segoe UI",sans-serif';
                c.textAlign = 'center';
                c.fillText(t('tree.nothing'), this.width / 2, this.height / 2);
            }
        }
        hit(x, y) { let nearest = null, d = Infinity; for (const n of this.visibleNodes()) {
            const p = this.point(n), dist = Math.hypot(p.x - x, p.y - y);
            const radius = Math.max(n.notable ? 8 : 6, Math.min(24, (n.notable ? 57 : 32) * this.scale)) + 3;
            if (dist < radius && dist < d) {
                nearest = n;
                d = dist;
            }
        } return nearest; }
        hideTooltip() { const el = this.tooltip; if (el)
            el.hidden = true; this.hover = null; }
        showTooltip(n, x, y) { const el = this.tooltip; if (!n) {
            this.hideTooltip();
            return;
        } el.innerHTML = `<strong>${esc(n.name)}</strong>${n.stats.map(esc).join('<br>')}<span class="node-state">${esc(t(this.eligible(n) ? 'tree.inStage' : 'tree.notInStage'))}${this.selected.get(n.id) ? ' · ' + esc(t('tree.weaponSet', { set: this.selected.get(n.id) })) : ''}</span>`; el.hidden = false; el.style.left = Math.min(Math.max(x + 15, 8), this.width - el.offsetWidth - 8) + 'px'; el.style.top = Math.min(Math.max(y + 15, 65), this.height - el.offsetHeight - 8) + 'px'; }
        bind() { const cv = this.canvas; cv.onwheel = e => { e.preventDefault(); const r = cv.getBoundingClientRect(); this.zoom(Math.exp(-e.deltaY * .0015), e.clientX - r.left, e.clientY - r.top); }; cv.onpointerdown = e => { const r = cv.getBoundingClientRect(); this.drag = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, moved: false }; cv.setPointerCapture(e.pointerId); cv.classList.add('dragging'); this.hideTooltip(); }; cv.onpointermove = e => { const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; if (this.drag) {
            const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
            this.drag.moved = this.drag.moved || Math.abs(dx) + Math.abs(dy) > 4;
            this.tx = this.drag.tx + dx;
            this.ty = this.drag.ty + dy;
            this.draw();
        }
        else {
            const n = this.hit(x, y);
            if (n !== this.hover) {
                this.hover = n;
                this.draw();
            }
            this.showTooltip(n, x, y);
        } }; cv.onpointerup = e => { const r = cv.getBoundingClientRect(); if (!this.drag?.moved)
            this.showTooltip(this.hit(e.clientX - r.left, e.clientY - r.top), e.clientX - r.left, e.clientY - r.top); this.drag = null; cv.classList.remove('dragging'); }; cv.onpointercancel = () => { this.drag = null; cv.classList.remove('dragging'); }; cv.onpointerleave = () => { if (!this.drag) {
            this.hideTooltip();
            this.draw();
        } }; cv.ondblclick = e => { const r = cv.getBoundingClientRect(); this.zoom(1.8, e.clientX - r.left, e.clientY - r.top); }; cv.onkeydown = e => { if (['+', '=', '-', '0', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            e.preventDefault();
            if (e.key === '0')
                this.fit(true);
            else if (['+', '='].includes(e.key))
                this.zoom(1.3);
            else if (e.key === '-')
                this.zoom(1 / 1.3);
            else {
                this.tx += e.key === 'ArrowLeft' ? 50 : e.key === 'ArrowRight' ? -50 : 0;
                this.ty += e.key === 'ArrowUp' ? 50 : e.key === 'ArrowDown' ? -50 : 0;
                this.draw();
            }
        } }; }
    }
    return new PassiveTree(canvas, options);
}
