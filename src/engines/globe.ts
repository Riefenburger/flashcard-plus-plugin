import { App, setIcon } from 'obsidian';
import worldGeoJSON from '../data/world-50m.json';
import { BaseEngine } from './base-engine';
import { addFullscreenButton } from '../utils/fullscreen';

type GeoFeature = any;

function toRad(d: number) { return d * Math.PI / 180; }

/**
 * Orthographic projection — outside-sphere / globe view.
 * Returns [screenX, screenY, cosc]. cosc ≤ 0 = behind the globe.
 */
function proj(
    lon: number, lat: number,
    lon0: number, lat0: number,
    R: number, cx: number, cy: number
): [number, number, number] {
    const φ = toRad(lat),  λ = toRad(lon);
    const φ0 = toRad(lat0), λ0 = toRad(lon0);
    const cosc = Math.sin(φ0)*Math.sin(φ) + Math.cos(φ0)*Math.cos(φ)*Math.cos(λ - λ0);
    const x = R * Math.cos(φ) * Math.sin(λ - λ0);
    const y = R * (Math.cos(φ0)*Math.sin(φ) - Math.sin(φ0)*Math.cos(φ)*Math.cos(λ - λ0));
    return [cx + x, cy - y, cosc];
}

/** 3-D Cartesian centroid — handles the antimeridian wrap correctly. */
function centroidOf(f: GeoFeature): [number, number] {
    let sx = 0, sy = 0, sz = 0, n = 0;
    const geom = f.geometry;
    if (!geom) return [0, 0];
    const rings: number[][][] = geom.type === 'Polygon'
        ? geom.coordinates
        : (geom.coordinates as number[][][][]).flat(1);
    for (const ring of rings) {
        for (const c of ring) {
            const lo = toRad(c[0] ?? 0), la = toRad(c[1] ?? 0);
            sx += Math.cos(la)*Math.cos(lo); sy += Math.cos(la)*Math.sin(lo); sz += Math.sin(la); n++;
        }
    }
    if (!n) return [0, 0];
    return [
        Math.atan2(sy/n, sx/n) * 180/Math.PI,
        Math.atan2(sz/n, Math.hypot(sx/n, sy/n)) * 180/Math.PI,
    ];
}

/** Returns the stable ID for a GeoJSON feature. Matches geo-deck's f.adm0. */
function fid(f: GeoFeature): string {
    const p = f?.properties;
    return p?.ADM0_A3 || p?.ISO_A3 || p?.NAME || '';
}

/** Base globe radius for a given canvas size (zoom = 1). */
function globeR(W: number, H: number) { return Math.min(W, H) / 2 * 0.93; }

// ─────────────────────────────────────────────────────────────────────────────
// Horizon clipping — fixes edge glitches where countries straddle the horizon
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clips a polygon ring to the visible hemisphere (cosc >= 0).
 * When an edge crosses the horizon, the exact crossing point is found via
 * binary search and added to the output — preventing broken-polygon artefacts.
 */
function clipRing(
    ring: number[][],
    p: (lo: number, la: number) => [number, number, number]
): [number, number][] {
    const out: [number, number][] = [];
    const n = ring.length;
    for (let i = 0; i < n; i++) {
        const c0 = ring[i]!,  c1 = ring[(i + 1) % n]!;
        const lo0 = c0[0] ?? 0, la0 = c0[1] ?? 0;
        const lo1 = c1[0] ?? 0, la1 = c1[1] ?? 0;
        const [x0, y0, cc0] = p(lo0, la0);
        const [,   ,   cc1] = p(lo1, la1);
        if (cc0 >= 0) out.push([x0, y0]);
        if ((cc0 >= 0) !== (cc1 >= 0)) {
            // Edge crosses horizon — binary search for crossing point
            let lo = 0, hi = 1;
            for (let k = 0; k < 16; k++) {
                const m = (lo + hi) / 2;
                if (p(lo0 + m*(lo1-lo0), la0 + m*(la1-la0))[2] >= 0) lo = m; else hi = m;
            }
            const m = (lo + hi) / 2;
            const [cx2, cy2] = p(lo0 + m*(lo1-lo0), la0 + m*(la1-la0));
            out.push([cx2, cy2]);
        }
    }
    return out;
}

/** Draw a clipped ring as a closed canvas path. Returns false if too small to draw. */
function drawRing(ctx: CanvasRenderingContext2D,
                  ring: number[][],
                  p: (lo: number, la: number) => [number, number, number]): boolean {
    const pts = clipRing(ring, p);
    if (pts.length < 3) return false;
    ctx.beginPath();
    ctx.moveTo(pts[0]![0], pts[0]![1]);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k]![0], pts[k]![1]);
    ctx.closePath();
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core draw
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param zoom   >1 zooms in (scroll/pinch). Visual radius stays fixed;
 *               only the projection scales up so landmasses appear larger.
 * @param pointMarker  [lon, lat] of a point-feature marker (seas, mountains, etc.)
 */
function drawGlobe(
    canvas: HTMLCanvasElement,
    viewLon: number, viewLat: number,
    targetId: string | null,
    highlightIds: Set<string>,
    revealed: boolean,
    revealName: string,
    labelMap: Map<string, string>,
    zoom = 1,
    pointMarker: [number, number] | null = null
) {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const cx = W/2, cy = H/2;
    const halfMin = Math.min(W, H) / 2;
    const R     = halfMin * 0.93 * zoom;           // projection radius (scales with zoom)
    const baseR = Math.min(R, halfMin * 0.99);     // visual clip (grows with zoom, caps at container)
    const p = (lo: number, la: number) => proj(lo, la, viewLon, viewLat, R, cx, cy);
    const features = (worldGeoJSON as any).features as GeoFeature[];

    // Clip everything to the visible globe circle
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, baseR, 0, Math.PI*2); ctx.clip();

    // ── Ocean ─────────────────────────────────────────────────────────────────
    ctx.beginPath(); ctx.arc(cx, cy, baseR, 0, Math.PI*2);
    ctx.fillStyle = '#0d1d30'; ctx.fill();

    // ── Graticule ────────────────────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(60,110,160,0.13)'; ctx.lineWidth = 0.5;
    for (let la = -60; la <= 60; la += 30) {
        ctx.beginPath(); let first = true;
        for (let lo = -180; lo <= 180; lo += 3) {
            const [sx, sy, cosc] = p(lo, la);
            if (cosc < 0) { first = true; continue; }
            if (first) { ctx.moveTo(sx, sy); first = false; } else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
    }

    // ── Country fills (two passes: normal, then target on top) ────────────────
    for (const pass of [0, 1]) {
        for (const f of features) {
            const id = fid(f);
            const isTarget = id === targetId;
            const isHl = highlightIds.has(id);
            if (pass === 0 && isTarget) continue;
            if (pass === 1 && !isTarget) continue;

            let fill: string;
            if (isTarget && revealed)  fill = 'rgba(34,197,94,0.72)';
            else if (isTarget)         fill = 'rgba(249,115,22,0.68)';
            else if (isHl)             fill = 'rgba(249,115,22,0.62)';
            else                       fill = '#1c3550';

            const geom = f.geometry; if (!geom) continue;
            const rgs: number[][][][] = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
            ctx.fillStyle = fill;
            for (const rings of rgs) {
                for (const ring of rings) {
                    if (drawRing(ctx, ring, p)) ctx.fill();
                }
            }
        }
    }

    // ── Country borders ───────────────────────────────────────────────────────
    for (const f of features) {
        const id = fid(f);
        const isTarget = id === targetId;
        const geom = f.geometry; if (!geom) continue;
        const rgs: number[][][][] = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;

        ctx.strokeStyle = isTarget
            ? (revealed ? 'rgba(74,222,128,0.95)' : 'rgba(251,146,60,0.95)')
            : 'rgba(90,140,185,0.32)';
        ctx.lineWidth = isTarget ? 2 : 0.5;
        if (isTarget) { ctx.shadowColor = revealed ? '#22c55e' : '#f97316'; ctx.shadowBlur = 8; }

        for (const rings of rgs) {
            for (const ring of rings) {
                if (drawRing(ctx, ring, p)) ctx.stroke();
            }
        }
        if (isTarget) ctx.shadowBlur = 0;
    }

    // ── Point feature marker (seas, mountains, straits, etc.) ─────────────────
    if (pointMarker) {
        const [pLon, pLat] = pointMarker;
        const [sx, sy, cosc] = p(pLon, pLat);
        if (cosc > 0) {
            const col = revealed ? '#4ade80' : '#f97316';
            ctx.save();
            ctx.shadowColor = col; ctx.shadowBlur = 12;
            // Draw a 5-pointed star
            ctx.beginPath();
            const r1 = 10, r2 = 4.5, pts = 5;
            for (let k = 0; k < pts * 2; k++) {
                const angle = (k * Math.PI / pts) - Math.PI / 2;
                const r = k % 2 === 0 ? r1 : r2;
                k === 0 ? ctx.moveTo(sx + r*Math.cos(angle), sy + r*Math.sin(angle))
                        : ctx.lineTo(sx + r*Math.cos(angle), sy + r*Math.sin(angle));
            }
            ctx.closePath();
            ctx.fillStyle = col; ctx.fill();
            ctx.shadowBlur = 0;
            ctx.restore();
        }
    }

    ctx.restore(); // end globe clip

    // ── Atmosphere glow + rim (drawn outside clip so it's always full circle) ─
    const atm = ctx.createRadialGradient(cx, cy, baseR*0.88, cx, cy, baseR*1.1);
    atm.addColorStop(0, 'rgba(30,90,200,0)');
    atm.addColorStop(1, 'rgba(20,70,180,0.22)');
    ctx.beginPath(); ctx.arc(cx, cy, baseR*1.1, 0, Math.PI*2);
    ctx.fillStyle = atm; ctx.fill();

    ctx.beginPath(); ctx.arc(cx, cy, baseR, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(70,130,210,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();

    // ── Reveal name label ─────────────────────────────────────────────────────
    if (revealed && revealName) {
        let labelSx = cx, labelSy = cy, labelVisible = false;
        if (pointMarker) {
            const [sx, sy, cosc] = p(pointMarker[0], pointMarker[1]);
            if (cosc > 0.05) { labelSx = sx; labelSy = sy - 18; labelVisible = true; }
        } else if (targetId) {
            const tf = features.find(f => fid(f) === targetId);
            if (tf) {
                const [clo, cla] = centroidOf(tf);
                const [sx, sy, cosc] = p(clo, cla);
                if (cosc > 0.05) { labelSx = sx; labelSy = sy; labelVisible = true; }
            }
        }
        if (labelVisible) {
            ctx.font = 'bold 13px sans-serif';
            const tw = ctx.measureText(revealName).width;
            const px2 = 8, py2 = 5;
            ctx.fillStyle = 'rgba(8,18,38,0.85)';
            ctx.beginPath();
            ctx.roundRect(labelSx - tw/2 - px2, labelSy - 8 - py2, tw + px2*2, 16 + py2*2, 6);
            ctx.fill();
            ctx.fillStyle = '#4ade80';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(revealName, labelSx, labelSy);
        }
    }

    // ── Preview labels ────────────────────────────────────────────────────────
    if (labelMap.size > 0) {
        ctx.font = '9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (const f of features) {
            const label = labelMap.get(fid(f)); if (!label) continue;
            const [clo, cla] = centroidOf(f);
            const [sx, sy, cosc] = p(clo, cla);
            if (cosc < 0.15) continue;
            ctx.fillStyle = 'rgba(5,10,22,0.7)'; ctx.fillText(label, sx+0.5, sy+0.5);
            ctx.fillStyle = 'rgba(253,186,116,0.95)'; ctx.fillText(label, sx, sy);
        }
    }

    // ── Vignette ──────────────────────────────────────────────────────────────
    const vgn = ctx.createRadialGradient(cx, cy, baseR*0.6, cx, cy, baseR);
    vgn.addColorStop(0, 'rgba(0,0,0,0)'); vgn.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.beginPath(); ctx.arc(cx, cy, baseR, 0, Math.PI*2);
    ctx.fillStyle = vgn; ctx.fill();

    // ── Zoom hint (shown briefly when zoom > 1) ───────────────────────────────
    if (zoom > 1.05) {
        ctx.font = '11px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(150,180,220,0.55)';
        ctx.fillText(`${zoom.toFixed(1)}×`, cx + baseR - 6, cy - baseR + 6);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Drag + zoom interaction
// ─────────────────────────────────────────────────────────────────────────────

function attachGlobeDrag(
    canvas: HTMLCanvasElement,
    getView: () => [number, number],
    setView: (lon: number, lat: number) => void,
    getZoom: () => number,
    setZoom: (z: number) => void,
    redraw: () => void
): [() => void, () => boolean] {
    let dragging = false, lastX = 0, lastY = 0, moved = false;
    let lastPinchDist = 0;

    const baseR = () => globeR(canvas.clientWidth, canvas.clientHeight);
    const start = (x: number, y: number) => { dragging = true; moved = false; lastX = x; lastY = y; };
    const move  = (x: number, y: number) => {
        if (!dragging) return;
        const dx = x - lastX, dy = y - lastY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
        lastX = x; lastY = y;
        const f = 180 / Math.PI / (baseR() * getZoom());
        const [lon, lat] = getView();
        let newLon = lon - dx * f;
        if (newLon >  180) newLon -= 360;
        if (newLon < -180) newLon += 360;
        setView(newLon, Math.max(-88, Math.min(88, lat + dy * f)));
        redraw();
    };
    const end = () => { dragging = false; lastPinchDist = 0; };

    // Mouse
    const onMD = (e: MouseEvent) => start(e.clientX, e.clientY);
    const onMM = (e: MouseEvent) => move(e.clientX, e.clientY);

    // Scroll wheel zoom
    const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        setZoom(Math.max(1, Math.min(10, getZoom() * factor)));
        redraw();
    };

    // Double-click resets zoom
    const onDbl = () => { setZoom(1); redraw(); };

    // Touch
    const onTS = (e: TouchEvent) => {
        if (e.touches.length === 1) {
            start(e.touches[0]!.clientX, e.touches[0]!.clientY);
        } else if (e.touches.length === 2) {
            dragging = false;
            lastPinchDist = Math.hypot(
                e.touches[1]!.clientX - e.touches[0]!.clientX,
                e.touches[1]!.clientY - e.touches[0]!.clientY
            );
        }
    };
    const onTM = (e: TouchEvent) => {
        if (e.touches.length === 1) {
            move(e.touches[0]!.clientX, e.touches[0]!.clientY);
        } else if (e.touches.length === 2 && lastPinchDist > 0) {
            const dist = Math.hypot(
                e.touches[1]!.clientX - e.touches[0]!.clientX,
                e.touches[1]!.clientY - e.touches[0]!.clientY
            );
            setZoom(Math.max(1, Math.min(10, getZoom() * dist / lastPinchDist)));
            lastPinchDist = dist;
            redraw();
        }
    };

    canvas.addEventListener('mousedown', onMD);
    document.addEventListener('mousemove', onMM);
    document.addEventListener('mouseup', end);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDbl);
    canvas.addEventListener('touchstart', onTS, { passive: true });
    document.addEventListener('touchmove', onTM, { passive: true });
    document.addEventListener('touchend', end);

    const cleanup = () => {
        document.removeEventListener('mousemove', onMM);
        document.removeEventListener('mouseup', end);
        document.removeEventListener('touchmove', onTM);
        document.removeEventListener('touchend', end);
    };
    return [cleanup, () => moved];
}

// ─────────────────────────────────────────────────────────────────────────────
// Hit testing
// ─────────────────────────────────────────────────────────────────────────────

function pointInPoly(px: number, py: number, vs: [number,number][]): boolean {
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const [xi, yi] = vs[i]!, [xj, yj] = vs[j]!;
        if (((yi > py) !== (yj > py)) && px < (xj-xi)*(py-yi)/(yj-yi)+xi) inside = !inside;
    }
    return inside;
}

function hitTestGlobe(px: number, py: number, viewLon: number, viewLat: number,
                      W: number, H: number, zoom = 1): string | null {
    const halfMin = Math.min(W, H) / 2;
    const R = halfMin * 0.93 * zoom;
    const baseR = Math.min(R, halfMin * 0.99);
    const cx = W/2, cy = H/2;
    // Only reject clicks clearly outside the visible circle
    if (Math.hypot(px - cx, py - cy) > baseR + 2) return null;

    for (const f of (worldGeoJSON as any).features as GeoFeature[]) {
        const geom = f.geometry; if (!geom) continue;
        const rgs: number[][][][] = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
        for (const rings of rgs) {
            for (const ring of rings) {
                const pts: [number,number][] = [];
                let anyFront = false;
                for (const c of ring) {
                    const [sx, sy, cosc] = proj(c[0]??0, c[1]??0, viewLon, viewLat, R, cx, cy);
                    if (cosc > 0) anyFront = true;
                    pts.push([sx, sy]);
                }
                if (anyFront && pointInPoly(px, py, pts)) return fid(f);
            }
        }
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Off-screen arrow
// ─────────────────────────────────────────────────────────────────────────────

function drawOffscreenArrow(canvas: HTMLCanvasElement, targetLon: number, targetLat: number,
                             viewLon: number, viewLat: number, zoom = 1): void {
    const W = canvas.width, H = canvas.height;
    if (!W || !H) return;
    const cx = W/2, cy = H/2;
    const halfMin = Math.min(W, H) / 2;
    const R = halfMin * 0.93 * zoom;
    const baseR = Math.min(R, halfMin * 0.99);
    const edgePad = 32;
    const [sx, sy, cosc] = proj(targetLon, targetLat, viewLon, viewLat, R, cx, cy);
    if (cosc > 0 && sx >= edgePad && sx <= W-edgePad && sy >= edgePad && sy <= H-edgePad) return;

    let dx: number, dy: number;
    if (cosc > 0) { dx = sx - cx; dy = sy - cy; }
    else {
        const dLon = ((targetLon - viewLon + 540) % 360) - 180;
        dx = dLon; dy = -(targetLat - viewLat);
    }
    const len = Math.hypot(dx, dy); if (len < 0.001) return;
    const nx = dx/len, ny = dy/len;

    const ts: number[] = [];
    if (nx > 0) ts.push((W-cx-edgePad)/nx); if (nx < 0) ts.push((edgePad-cx)/nx);
    if (ny > 0) ts.push((H-cy-edgePad)/ny); if (ny < 0) ts.push((edgePad-cy)/ny);
    const t = Math.min(...ts.filter(v => v > 0)); if (!isFinite(t)) return;

    const ctx = canvas.getContext('2d')!, sz = 13;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.translate(cx + nx*t, cy + ny*t);
    ctx.rotate(Math.atan2(ny, nx));
    ctx.shadowColor = '#22c55e'; ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(sz, 0); ctx.lineTo(-sz*0.55, sz*0.5); ctx.lineTo(-sz*0.55, -sz*0.5);
    ctx.closePath(); ctx.fillStyle = '#4ade80'; ctx.fill();
    ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine
// ─────────────────────────────────────────────────────────────────────────────

export class GlobeEngine {

    private static findFeature(id: string): GeoFeature | undefined {
        return ((worldGeoJSON as any).features as GeoFeature[]).find(f => fid(f) === id);
    }

    // ── Quiz (text input) mode ─────────────────────────────────────────────
    static async renderInModal(
        app: App,
        filePath: string,
        container: HTMLElement,
        cardData: any,
        cloze: any,
        onComplete: (isCorrect: boolean, userAnswer: string) => void,
        dict: Record<string, string> = {}
    ): Promise<void> {
        container.empty();
        container.addClass('gi-card-col');

        const featureId: string = cloze.featureId ?? '';
        const isPoint = cloze.type === 'point' || (!featureId && cloze.lat != null);
        const pointMarker: [number, number] | null = isPoint
            ? [cloze.lng ?? 0, cloze.lat ?? 0] : null;

        const target = featureId ? GlobeEngine.findFeature(featureId) : null;
        const [cLon0, cLat0] = target ? centroidOf(target)
            : pointMarker ? pointMarker : [0, 20];

        // Input bar
        const inputWrap = container.createDiv({ cls: 'gi-map-input-wrap' });
        inputWrap.createEl('span', { text: cloze.front || 'Name this location', cls: 'gi-map-input-label' });
        const inputEl = inputWrap.createEl('input', {
            type: 'text', placeholder: 'Type answer…', cls: 'gi-map-answer-input',
            attr: { autocomplete: 'off', autocorrect: 'off', spellcheck: 'false' },
        });
        const submitBtn = inputWrap.createEl('button', { cls: 'gi-map-submit-btn mod-cta' });
        setIcon(submitBtn, 'arrow-right');

        const wrap = container.createDiv({ cls: 'gi-globe-wrap' });
        const canvas = wrap.createEl('canvas', { cls: 'gi-globe-canvas' });

        let viewLon = cLon0, viewLat = cLat0, zoom = 1;
        let revealed = false, revealName = '';

        const draw = () => {
            drawGlobe(canvas, viewLon, viewLat, featureId || null, new Set(),
                revealed, revealName, new Map(), zoom,
                revealed ? pointMarker : pointMarker);
            if (revealed) drawOffscreenArrow(canvas, cLon0, cLat0, viewLon, viewLat, zoom);
        };

        const ro = new ResizeObserver(() => draw());
        ro.observe(wrap);
        requestAnimationFrame(draw);
        addFullscreenButton(container, draw);

        const [cleanupDrag] = attachGlobeDrag(
            canvas,
            () => [viewLon, viewLat],
            (lo, la) => { viewLon = lo; viewLat = la; },
            () => zoom, (z) => { zoom = z; },
            draw
        );

        const handleSubmit = (rawAnswer: string) => {
            inputWrap.remove();
            const ua = rawAnswer.trim().toLowerCase();
            const correct = (cloze.back || []).map((a: string) => a.toLowerCase());
            if (correct.includes(ua)) {
                onComplete(true, rawAnswer.trim());
            } else {
                viewLon = cLon0; viewLat = cLat0; zoom = 1;
                revealed = true;
                revealName = Array.isArray(cloze.back)
                    ? (cloze.back[0] ?? '') : (cloze.featureName ?? featureId);
                draw();
                const card = container.createDiv({ cls: 'gi-incorrect-card' });
                const hdr = card.createDiv({ cls: 'gi-incorrect-hdr' });
                setIcon(hdr.createDiv({ cls: 'gi-incorrect-icon' }), 'x-circle');
                hdr.createEl('span', { text: 'Incorrect', cls: 'gi-incorrect-title' });
                BaseEngine.renderIncorrectContent(app, filePath, card, cloze, rawAnswer.trim(),
                    (ok) => onComplete(ok, rawAnswer.trim()), [], dict, cardData);
            }
        };
        submitBtn.onclick = () => handleSubmit(inputEl.value);
        inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSubmit(inputEl.value); });

        (container as any)._leafletCleanup = () => { ro.disconnect(); cleanupDrag(); };
    }

    // ── Easy mode (click to identify) ─────────────────────────────────────
    static renderEasyMode(
        app: App,
        filePath: string,
        container: HTMLElement,
        cardData: any,
        cloze: any,
        onComplete: (isCorrect: boolean, userAnswer: string) => void,
        dict: Record<string, string> = {}
    ): void {
        container.empty();
        container.addClass('gi-card-col');

        const featureId: string = cloze.featureId ?? '';
        const correctName = Array.isArray(cloze.back) ? (cloze.back[0] ?? featureId) : featureId;
        const target = GlobeEngine.findFeature(featureId);
        const [cLon0, cLat0] = target ? centroidOf(target) : [0, 20];

        const promptWrap = container.createDiv({ cls: 'gi-easy-prompt' });
        promptWrap.createEl('span', { text: 'Click on: ', cls: 'gi-easy-prompt-label' });
        promptWrap.createEl('strong', { text: correctName, cls: 'gi-easy-prompt-name' });

        const wrap = container.createDiv({ cls: 'gi-globe-wrap' });
        const canvas = wrap.createEl('canvas', { cls: 'gi-globe-canvas' });

        let viewLon = cLon0, viewLat = cLat0, zoom = 1;
        let answered = false, revealTarget: string | null = null, revealLabel = '';

        const draw = () => {
            drawGlobe(canvas, viewLon, viewLat, revealTarget, new Set(),
                revealTarget !== null, revealLabel, new Map(), zoom);
            if (revealTarget) drawOffscreenArrow(canvas, cLon0, cLat0, viewLon, viewLat, zoom);
        };

        const ro = new ResizeObserver(() => draw());
        ro.observe(wrap);
        requestAnimationFrame(draw);
        addFullscreenButton(container, draw);

        const [cleanupDrag, wasDragged] = attachGlobeDrag(
            canvas,
            () => [viewLon, viewLat],
            (lo, la) => { viewLon = lo; viewLat = la; },
            () => zoom, (z) => { zoom = z; },
            draw
        );

        canvas.addEventListener('click', (e: MouseEvent) => {
            if (answered || wasDragged()) return;
            const rect = canvas.getBoundingClientRect();
            const clickedId = hitTestGlobe(
                e.clientX - rect.left, e.clientY - rect.top,
                viewLon, viewLat, canvas.clientWidth, canvas.clientHeight, zoom
            );

            answered = true;
            const isCorrect = clickedId === featureId;
            const userAnswer = clickedId ?? '';

            if (!isCorrect) { viewLon = cLon0; viewLat = cLat0; zoom = 1; }
            revealTarget = featureId;
            revealLabel = isCorrect ? '' : correctName;
            draw();
            promptWrap.remove();

            if (isCorrect) {
                const badge = container.createDiv({ cls: 'gi-easy-badge gi-easy-correct' });
                setIcon(badge.createDiv(), 'check-circle');
                badge.createEl('span', { text: 'Correct!' });
                setTimeout(() => onComplete(true, correctName), 900);
            } else {
                const card = container.createDiv({ cls: 'gi-incorrect-card' });
                const hdr = card.createDiv({ cls: 'gi-incorrect-hdr' });
                setIcon(hdr.createDiv({ cls: 'gi-incorrect-icon' }), 'x-circle');
                hdr.createEl('span', { text: 'Incorrect', cls: 'gi-incorrect-title' });
                BaseEngine.renderIncorrectContent(app, filePath, card, cloze, userAnswer,
                    (ok) => onComplete(ok, userAnswer), [], dict, cardData);
            }
        });

        (container as any)._leafletCleanup = () => { ro.disconnect(); cleanupDrag(); };
    }

    // ── Inline preview ────────────────────────────────────────────────────
    static renderPreview(
        container: HTMLElement,
        cardData: any
    ): { flyTo: (clozeIndex: number) => void } {
        const features = (worldGeoJSON as any).features as GeoFeature[];
        const clozes: any[] = cardData.clozes || [];

        const highlightIds = new Set<string>();
        const labelMap = new Map<string, string>();
        const targets: [number, number][] = [];

        for (const c of clozes) {
            if (c.featureId) {
                highlightIds.add(c.featureId);
                const name = c.featureName || (Array.isArray(c.back) ? c.back[0] : null) || c.featureId;
                labelMap.set(c.featureId, name);
                const f = features.find(feat => fid(feat) === c.featureId);
                targets.push(f ? centroidOf(f) : [0, 20]);
            } else {
                targets.push([c.lng ?? 0, c.lat ?? 20]);
            }
        }

        let sumX = 0, sumY = 0, sumZ = 0;
        for (const [lo, la] of targets) {
            const loR = toRad(lo), laR = toRad(la);
            sumX += Math.cos(laR)*Math.cos(loR); sumY += Math.cos(laR)*Math.sin(loR); sumZ += Math.sin(laR);
        }
        const n = targets.length || 1;
        let viewLon = Math.atan2(sumY/n, sumX/n) * 180/Math.PI;
        let viewLat = Math.atan2(sumZ/n, Math.hypot(sumX/n, sumY/n)) * 180/Math.PI;
        let zoom = 1;

        const canvas = container.createEl('canvas', { cls: 'gi-globe-canvas' });
        const draw = () => drawGlobe(canvas, viewLon, viewLat, null, highlightIds,
            false, '', labelMap, zoom);

        const ro = new ResizeObserver(() => draw());
        ro.observe(container);
        requestAnimationFrame(draw);
        addFullscreenButton(container, draw);

        const [cleanup] = attachGlobeDrag(
            canvas,
            () => [viewLon, viewLat],
            (lo, la) => { viewLon = lo; viewLat = la; },
            () => zoom, (z) => { zoom = z; },
            draw
        );
        (container as any)._leafletCleanup = () => { ro.disconnect(); cleanup(); };

        const flyTo = (idx: number) => {
            const t = targets[idx]; if (!t) return;
            viewLon = t[0]; viewLat = t[1]; zoom = 1; draw();
        };
        return { flyTo };
    }
}
