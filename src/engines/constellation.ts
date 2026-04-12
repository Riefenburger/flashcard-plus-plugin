import { App, setIcon } from 'obsidian';
import boundsGeoJSON from '../data/constellations.bounds.json';
import linesGeoJSON from '../data/constellations.lines.json';
import { BaseEngine } from './base-engine';
import { addFullscreenButton } from '../utils/fullscreen';

// stars.6.json has dots in its name so we use require
// eslint-disable-next-line @typescript-eslint/no-var-requires
const starsGeoJSON: any = require('../data/stars.6.json');

function toRad(d: number): number { return d * Math.PI / 180; }

/**
 * Gnomonic (perspective) projection — inside-sphere / sky-view.
 * Gives a "window into the sky" look matching star-atlas software.
 *
 * lon = RA in degrees, lat = Dec in degrees.
 * scale = halfCanvasSize × zoom  — higher zoom means a narrower, magnified view.
 * −x flips East↔West so East is LEFT, matching how the sky looks from Earth.
 *
 * Returns [screenX, screenY, cosc].
 *   cosc ≤ 0 means the point is at or past 90 ° from the view centre — not visible.
 */
function proj(
    lon: number, lat: number,
    cLon: number, cLat: number,
    scale: number, cx: number, cy: number
): [number, number, number] {
    const φ  = toRad(lat),  λ  = toRad(lon);
    const φ0 = toRad(cLat), λ0 = toRad(cLon);
    const Δλ = λ - λ0;
    const cosφ = Math.cos(φ), sinφ = Math.sin(φ);
    const cosφ0 = Math.cos(φ0), sinφ0 = Math.sin(φ0);

    const cosc = sinφ0 * sinφ + cosφ0 * cosφ * Math.cos(Δλ);
    if (cosc <= 0.001) return [cx, cy, -1]; // at / behind 90 ° horizon

    const x = cosφ * Math.sin(Δλ) / cosc;
    const y = (cosφ0 * sinφ - sinφ0 * cosφ * Math.cos(Δλ)) / cosc;

    return [cx - x * scale, cy - y * scale, cosc]; // −x = east is left (sky view)
}

function centroidOf(feature: any): [number, number] {
    // 3-D Cartesian averaging handles the RA 0°/360° wrap-around correctly.
    let sumX = 0, sumY = 0, sumZ = 0, n = 0;
    const geom = feature.geometry;
    const rings: number[][][] = geom.type === 'Polygon'
        ? geom.coordinates
        : (geom.coordinates as number[][][][]).flat(1);
    for (const ring of rings) {
        for (const coord of ring) {
            const lo = toRad(coord[0] ?? 0);
            const la = toRad(coord[1] ?? 0);
            sumX += Math.cos(la) * Math.cos(lo);
            sumY += Math.cos(la) * Math.sin(lo);
            sumZ += Math.sin(la);
            n++;
        }
    }
    if (!n) return [0, 0];
    const lon = Math.atan2(sumY / n, sumX / n) * 180 / Math.PI;
    const lat = Math.atan2(sumZ / n, Math.hypot(sumX / n, sumY / n)) * 180 / Math.PI;
    return [lon, lat];
}

/** Shared rendering core used by both renderInModal and renderPreview. */
function drawSky(
    canvas: HTMLCanvasElement,
    viewLon: number, viewLat: number,
    zoom: number,                 // 1 = full hemisphere; >1 = magnified
    targetId: string | null,      // null = preview mode (no target)
    highlightIds: Set<string>,    // ids to show name labels (preview) or to glow (review)
    showLines: boolean,
    revealed: boolean,
    revealName: string,
    labelMap: Map<string, string> // featureId → display name (for preview labels)
) {
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (!W || !H) return;
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const cx = W / 2, cy = H / 2;
    // Gnomonic scale: halfSize * factor / zoom.
    // factor=1.5 → ~68° total FOV at zoom=1, similar to Stellarium default.
    // Higher zoom → smaller scale → narrower FOV (more magnified).
    const halfSize  = Math.min(W, H) / 2;
    const baseScale = halfSize * 1.5;
    const scale     = baseScale * zoom;

    const bounds = (boundsGeoJSON as any).features as any[];
    const lines  = (linesGeoJSON as any).features as any[];
    const stars  = starsGeoJSON.features as any[];

    const p = (lo: number, la: number) =>
        proj(lo, la, viewLon, viewLat, scale, cx, cy);

    // ── Sky background — fills full canvas (no globe rim) ────────────────────
    ctx.fillStyle = '#060d1a';
    ctx.fillRect(0, 0, W, H);

    // ── Non-target boundary grid lines ────────────────────────────────────────
    for (const f of bounds) {
        if (f.id === targetId) continue;
        const geom = f.geometry;
        const ringGroups: number[][][][] = geom.type === 'Polygon'
            ? [geom.coordinates as number[][][]]
            : geom.coordinates as number[][][][];
        ctx.strokeStyle = 'rgba(50,80,140,0.32)';
        ctx.lineWidth = 0.5;
        for (const rings of ringGroups) {
            for (const ring of rings) {
                ctx.beginPath();
                let first = true;
                for (const coord of ring) {
                    const [sx, sy, z] = p(coord[0] ?? 0, coord[1] ?? 0);
                    if (z < 0) { first = true; continue; }
                    if (first) { ctx.moveTo(sx, sy); first = false; }
                    else ctx.lineTo(sx, sy);
                }
                ctx.closePath();
                ctx.stroke();
            }
        }
    }

    // ── Collect target star positions from line endpoints ────────────────────
    // stars.6.json has no `con` field, so we derive constellation stars
    // from the stick-figure line endpoints (exact RA/Dec of each star node).
    const targetStarCoords = new Set<string>(); // "lo,la" keys
    const targetStarPoints: Array<[number, number]> = [];
    if (targetId) {
        const targetLines = lines.find((f: any) => f.id === targetId);
        if (targetLines) {
            const segs: number[][][] = targetLines.geometry.type === 'LineString'
                ? [targetLines.geometry.coordinates as number[][]]
                : targetLines.geometry.coordinates as number[][][];
            for (const seg of segs) {
                for (const coord of seg) {
                    const key = `${coord[0]},${coord[1]}`;
                    if (!targetStarCoords.has(key)) {
                        targetStarCoords.add(key);
                        targetStarPoints.push([coord[0] ?? 0, coord[1] ?? 0]);
                    }
                }
            }
        }
    }

    // ── Background stars (dim when a target is active) ───────────────────────
    for (const f of stars) {
        const coords = f.geometry.coordinates as number[];
        const lo = coords[0] ?? 0, la = coords[1] ?? 0;
        const [sx, sy, z] = p(lo, la);
        if (z < 0) continue;
        const mag: number = f.properties.mag ?? 5;
        const sr = Math.max(0.5, (6.5 - mag) * 0.45);
        const baseAlpha = Math.min(1, 0.4 + (6.5 - mag) / 7.5);
        // Dim background stars a bit when a target is shown, but keep them visible
        const alpha = targetId ? baseAlpha * 0.45 : baseAlpha;
        const bv: number = parseFloat(f.properties.bv) || 0;
        const rr = Math.round(Math.min(255, 195 + bv * 12));
        const gg = Math.round(Math.min(255, 210 - bv * 4));
        const bb = Math.round(Math.min(255, 255 - bv * 22));
        if (!targetId && mag < 2) {
            const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 3.5);
            grd.addColorStop(0, `rgba(${rr},${gg},${bb},${(alpha * 0.35).toFixed(2)})`);
            grd.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.beginPath();
            ctx.arc(sx, sy, sr * 3.5, 0, Math.PI * 2);
            ctx.fillStyle = grd;
            ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rr},${gg},${bb},${alpha.toFixed(2)})`;
        ctx.fill();
    }

    // ── Stick figure lines (all constellations) ───────────────────────────────
    if (showLines) {
        for (const f of lines) {
            const isTarget = f.id === targetId;
            const segs: number[][][] = f.geometry.type === 'LineString'
                ? [f.geometry.coordinates as number[][]]
                : f.geometry.coordinates as number[][][];
            ctx.strokeStyle = isTarget
                ? (revealed ? 'rgba(74,222,128,0.92)' : 'rgba(130,175,255,0.90)')
                : 'rgba(60,90,170,0.20)';
            ctx.lineWidth = isTarget ? 1.6 : 0.6;
            ctx.lineCap = 'round';
            for (const seg of segs) {
                ctx.beginPath();
                let first = true;
                for (const coord of seg) {
                    const [sx, sy, z] = p(coord[0] ?? 0, coord[1] ?? 0);
                    if (z < 0) { first = true; continue; }
                    if (first) { ctx.moveTo(sx, sy); first = false; }
                    else ctx.lineTo(sx, sy);
                }
                ctx.stroke();
            }
        }
    }

    // ── Target constellation — glowing border (NO fill, so stars show fully) ──
    if (targetId) {
        const targetFeature = bounds.find((f: any) => f.id === targetId);
        if (targetFeature) {
            const geom = targetFeature.geometry;
            const ringGroups: number[][][][] = geom.type === 'Polygon'
                ? [geom.coordinates as number[][][]]
                : geom.coordinates as number[][][][];

            const glowColor = revealed ? '#22c55e' : '#f97316';
            const edgeColor = revealed ? '#4ade80' : '#fb923c';

            for (const rings of ringGroups) {
                for (const ring of rings) {
                    ctx.beginPath();
                    let first = true;
                    for (const coord of ring) {
                        const [sx, sy, z] = p(coord[0] ?? 0, coord[1] ?? 0);
                        if (z < 0) { first = true; continue; }
                        if (first) { ctx.moveTo(sx, sy); first = false; }
                        else ctx.lineTo(sx, sy);
                    }
                    ctx.closePath();
                    // Outer glow pass
                    ctx.shadowColor = glowColor;
                    ctx.shadowBlur = 12;
                    ctx.strokeStyle = glowColor;
                    ctx.lineWidth = 3.5;
                    ctx.stroke();
                    // Sharp inner edge
                    ctx.shadowBlur = 0;
                    ctx.strokeStyle = edgeColor;
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                }
            }
            ctx.shadowBlur = 0;
        }
    }

    // ── Target constellation stars — bright gold pass (drawn on top of lines) ──
    // Size is proportional to the projection radius so they don't balloon at low zoom.
    const conStarR = Math.max(1.8, scale * 0.008); // ~2px at default scale
    const glowR = conStarR * 2.4;
    for (const [lo, la] of targetStarPoints) {
        const [sx, sy, z] = p(lo, la);
        if (z < 0) continue;

        // Tight glow halo
        const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR);
        grd.addColorStop(0, 'rgba(255, 230, 80, 0.75)');
        grd.addColorStop(0.5, 'rgba(255, 200, 40, 0.25)');
        grd.addColorStop(1, 'rgba(255, 160, 0, 0)');
        ctx.beginPath();
        ctx.arc(sx, sy, glowR, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();

        // Sharp bright core
        ctx.shadowColor = '#ffe050';
        ctx.shadowBlur = conStarR * 2;
        ctx.beginPath();
        ctx.arc(sx, sy, conStarR, 0, Math.PI * 2);
        ctx.fillStyle = '#ffee88';
        ctx.fill();
        ctx.shadowBlur = 0;
    }

    // ── Preview mode: name labels for included constellations ─────────────────
    if (labelMap.size > 0) {
        const fontSize = Math.max(7, Math.round(scale / 35));
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const f of bounds) {
            const label = labelMap.get(f.id);
            if (!label) continue;
            const [clo, cla] = centroidOf(f);
            const [sx, sy, z] = p(clo, cla);
            if (z < 0.08) continue; // skip near / behind horizon
            // Shadow for legibility
            ctx.fillStyle = 'rgba(5,10,22,0.75)';
            ctx.fillText(label, sx + 0.5, sy + 0.5);
            ctx.fillStyle = highlightIds.has(f.id)
                ? 'rgba(190,210,255,0.95)'
                : 'rgba(110,135,190,0.60)';
            ctx.fillText(label, sx, sy);
        }
    }

    // ── Reveal name label ─────────────────────────────────────────────────────
    if (revealed && revealName && targetId) {
        const targetFeature = bounds.find((f: any) => f.id === targetId);
        if (targetFeature) {
            const [clo, cla] = centroidOf(targetFeature);
            const [sx, sy, z] = p(clo, cla);
            if (z > 0) {
                ctx.font = 'bold 13px sans-serif';
                const tw = ctx.measureText(revealName).width;
                ctx.fillStyle = 'rgba(8,18,38,0.80)';
                const px = 7, py = 4;
                ctx.beginPath();
                ctx.roundRect(sx - tw/2 - px, sy - 8 - py, tw + px*2, 16 + py*2, 6);
                ctx.fill();
                ctx.fillStyle = '#4ade80';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(revealName, sx, sy);
            }
        }
    }

    // ── Corner vignette for depth — subtle, no globe rim ─────────────────────
    const grad = ctx.createRadialGradient(cx, cy, halfSize * 0.7, cx, cy, Math.hypot(W, H) / 2);
    grad.addColorStop(0, 'rgba(6,13,26,0)');
    grad.addColorStop(1, 'rgba(3,7,16,0.55)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
}

/**
 * Draws a green arrow at the canvas edge pointing toward the target constellation
 * when its centroid is off-screen. Must be called after drawSky (canvas dims are set).
 */
function drawOffscreenArrow(
    canvas: HTMLCanvasElement,
    targetLon: number, targetLat: number,
    viewLon: number, viewLat: number,
    zoom: number
): void {
    const W = canvas.width;
    const H = canvas.height;
    if (!W || !H) return;
    const cx = W / 2, cy = H / 2;
    const scale = Math.min(W, H) / 2 * 1.5 * zoom;
    const edgePad = 32;

    const [sx, sy, cosc] = proj(targetLon, targetLat, viewLon, viewLat, scale, cx, cy);

    // If the centroid is already well inside the canvas, no arrow needed
    const onScreen = cosc > 0.001
        && sx >= edgePad && sx <= W - edgePad
        && sy >= edgePad && sy <= H - edgePad;
    if (onScreen) return;

    // Direction toward the target
    let dx: number, dy: number;
    if (cosc > 0.001) {
        // In front hemisphere but past the canvas edge
        dx = sx - cx;
        dy = sy - cy;
    } else {
        // Behind the 90° horizon — approximate direction via angular diff
        const dLon = ((targetLon - viewLon + 540) % 360) - 180;
        const dLat = targetLat - viewLat;
        dx = -dLon; // east is left (−x flip) in gnomonic
        dy = -dLat; // north is up (−y)
    }

    const len = Math.hypot(dx, dy);
    if (len < 0.001) return;
    const nx = dx / len, ny = dy / len;

    // Find where the ray from canvas centre hits the padded edge rectangle
    const ts: number[] = [];
    if (nx > 0) ts.push((W - cx - edgePad) / nx);
    if (nx < 0) ts.push((edgePad - cx) / nx);
    if (ny > 0) ts.push((H - cy - edgePad) / ny);
    if (ny < 0) ts.push((edgePad - cy) / ny);
    const tMin = Math.min(...ts.filter(v => v > 0));
    if (!isFinite(tMin)) return;

    const ax = cx + nx * tMin;
    const ay = cy + ny * tMin;
    const arrowSize = 13;

    const ctx = canvas.getContext('2d')!;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.translate(ax, ay);
    ctx.rotate(Math.atan2(ny, nx));
    ctx.shadowColor = '#22c55e';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(arrowSize, 0);
    ctx.lineTo(-arrowSize * 0.55, arrowSize * 0.5);
    ctx.lineTo(-arrowSize * 0.55, -arrowSize * 0.5);
    ctx.closePath();
    ctx.fillStyle = '#4ade80';
    ctx.fill();
    ctx.restore();
}

/** Attach drag-to-rotate interaction to a canvas.
 *  Returns [cleanupFn, wasDragging].
 *  wasDragging() returns true if the pointer moved > 4px since mousedown —
 *  use it to suppress click-after-pan in easy mode. */
function attachDrag(
    canvas: HTMLCanvasElement,
    getView: () => [number, number, number],  // [lon, lat, zoom]
    setView: (lon: number, lat: number, zoom: number) => void,
    redraw: () => void
): [() => void, () => boolean] {
    let dragging = false, lastX = 0, lastY = 0;
    let dragMoved = false;   // true once pointer moves > 4px during a press
    let lastPinchDist = 0;

    const startDrag = (cx: number, cy: number) => {
        dragging = true; dragMoved = false; lastX = cx; lastY = cy;
    };
    const moveDrag  = (cx: number, cy: number) => {
        if (!dragging) return;
        const dx = cx - lastX, dy = cy - lastY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragMoved = true;
        lastX = cx; lastY = cy;
        const [lon, lat, zoom] = getView();
        // Gnomonic sensitivity: 1 pixel = 1/(scale) radians converted to degrees
        const scale = Math.min(canvas.clientWidth, canvas.clientHeight) / 2 * 1.5 * zoom;
        let newLon = lon + (dx / scale) * (180 / Math.PI);
        const newLat = Math.max(-90, Math.min(90, lat + (dy / scale) * (180 / Math.PI)));
        if (newLon >  180) newLon -= 360;
        if (newLon < -180) newLon += 360;
        setView(newLon, newLat, zoom);
        redraw();
    };
    const endDrag = () => { dragging = false; lastPinchDist = 0; };

    const onMouseDown  = (e: MouseEvent) => startDrag(e.clientX, e.clientY);
    const onMouseMove  = (e: MouseEvent) => moveDrag(e.clientX, e.clientY);

    // Scroll wheel zoom
    const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const [lon, lat, zoom] = getView();
        const factor = e.deltaY > 0 ? 0.92 : 1.09;
        setView(lon, lat, Math.max(1, Math.min(10, zoom * factor)));
        redraw();
    };

    // Touch: single-finger drag, two-finger pinch zoom
    const onTouchStart = (e: TouchEvent) => {
        if (e.touches.length === 1) {
            startDrag(e.touches[0]!.clientX, e.touches[0]!.clientY);
        } else if (e.touches.length === 2) {
            dragging = false;
            const dx = e.touches[0]!.clientX - e.touches[1]!.clientX;
            const dy = e.touches[0]!.clientY - e.touches[1]!.clientY;
            lastPinchDist = Math.hypot(dx, dy);
        }
    };
    const onTouchMove  = (e: TouchEvent) => {
        if (e.touches.length === 1) {
            moveDrag(e.touches[0]!.clientX, e.touches[0]!.clientY);
        } else if (e.touches.length === 2) {
            const dx = e.touches[0]!.clientX - e.touches[1]!.clientX;
            const dy = e.touches[0]!.clientY - e.touches[1]!.clientY;
            const dist = Math.hypot(dx, dy);
            if (lastPinchDist > 0) {
                const [lon, lat, zoom] = getView();
                setView(lon, lat, Math.max(1, Math.min(10, zoom * (dist / lastPinchDist))));
                redraw();
            }
            lastPinchDist = dist;
        }
    };

    canvas.addEventListener('mousedown',  onMouseDown);
    canvas.addEventListener('wheel',      onWheel, { passive: false });
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   endDrag);
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend',  endDrag);

    const cleanup = () => {
        canvas.removeEventListener('wheel', onWheel);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup',   endDrag);
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend',  endDrag);
    };
    const wasDragged = () => dragMoved;
    return [cleanup, wasDragged];
}

/** 2-D ray-casting point-in-polygon (screen coordinates). */
function pointInPolygon(px: number, py: number, vs: number[][]): boolean {
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const xi = vs[i]![0]!, yi = vs[i]![1]!;
        const xj = vs[j]![0]!, yj = vs[j]![1]!;
        const intersect = ((yi > py) !== (yj > py))
            && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

/**
 * Returns the constellation featureId whose boundary contains the canvas point (px, py),
 * or null if none found.
 */
function hitTestConstellation(
    px: number, py: number,
    viewLon: number, viewLat: number,
    zoom: number, W: number, H: number
): string | null {
    const scale = Math.min(W, H) / 2 * 1.5 * zoom; // must match drawSky formula
    const cx = W / 2, cy = H / 2;
    const bounds = (boundsGeoJSON as any).features as any[];

    for (const f of bounds) {
        const geom = f.geometry;
        const ringGroups: number[][][][] = geom.type === 'Polygon'
            ? [geom.coordinates as number[][][]]
            : geom.coordinates as number[][][][];
        for (const rings of ringGroups) {
            for (const ring of rings) {
                const pts: number[][] = [];
                let anyBehind = false;
                for (const coord of ring) {
                    const [sx, sy, cosc] = proj(coord[0] ?? 0, coord[1] ?? 0, viewLon, viewLat, scale, cx, cy);
                    if (cosc <= 0) { anyBehind = true; break; }
                    pts.push([sx, sy]);
                }
                // Skip rings with any vertex behind the horizon — their projected
                // coordinates are degenerate (all snap to cx,cy) and cause false hits.
                if (anyBehind) continue;
                if (pointInPolygon(px, py, pts)) return f.id as string;
            }
        }
    }
    return null;
}

export class ConstellationEngine {
    /**
     * Render the full interactive flashcard globe (review mode).
     * Called by session-modal for each card.
     */
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

        const showLines: boolean = cardData.showLines !== false;
        const featureId: string = cloze.featureId ?? '';

        // ── Input bar (at top so keyboard doesn't cover it on mobile) ──────
        const inputWrap = container.createDiv({ cls: 'gi-map-input-wrap' });
        inputWrap.createEl('span', { text: cloze.front || 'Name this constellation', cls: 'gi-map-input-label' });
        const inputEl = inputWrap.createEl('input', {
            type: 'text',
            placeholder: 'Type constellation name…',
            cls: 'gi-map-answer-input',
            attr: { autocomplete: 'off', autocorrect: 'off', spellcheck: 'false' },
        });
        const submitBtn = inputWrap.createEl('button', { cls: 'gi-map-submit-btn mod-cta' });
        setIcon(submitBtn, 'arrow-right');
        setTimeout(() => inputEl.focus(), 50);

        const wrap = container.createDiv({ cls: 'gi-const-wrap' });
        const canvas = wrap.createEl('canvas', { cls: 'gi-const-canvas' });

        const bounds = (boundsGeoJSON as any).features as any[];
        const target = bounds.find((f: any) => f.id === featureId);
        const [cLon0, cLat0] = target ? centroidOf(target) : [0, 0];

        let viewLon = cLon0, viewLat = cLat0, viewZoom = 1;
        let revealed = false, revealName = '';

        const draw = () => {
            drawSky(canvas, viewLon, viewLat, viewZoom,
                featureId, new Set<string>(), showLines,
                revealed, revealName, new Map());
            if (revealed) drawOffscreenArrow(canvas, cLon0, cLat0, viewLon, viewLat, viewZoom);
        };

        const ro = new ResizeObserver(() => draw());
        ro.observe(wrap);
        requestAnimationFrame(draw);
        const fsTarget = container.closest('.gi-review-root') as HTMLElement ?? container;
        addFullscreenButton(fsTarget, draw);

        const [cleanupDrag] = attachDrag(
            canvas,
            () => [viewLon, viewLat, viewZoom],
            (lo, la, zo) => { viewLon = lo; viewLat = la; viewZoom = zo; },
            draw
        );

        const handleSubmit = (rawAnswer: string) => {
            inputWrap.remove();
            const userAnswer = rawAnswer.trim().toLowerCase();
            const correctAnswers = (cloze.back || []).map((a: string) => a.toLowerCase());
            const isCorrect = correctAnswers.includes(userAnswer);
            if (isCorrect) {
                onComplete(true, rawAnswer.trim());
            } else {
                viewLon = cLon0; viewLat = cLat0; // pan to correct constellation
                revealed = true;
                revealName = Array.isArray(cloze.back) ? (cloze.back[0] ?? '') : (cloze.featureName ?? featureId);
                draw();
                const compareCard = container.createDiv({ cls: 'gi-incorrect-card' });
                const hdr = compareCard.createDiv({ cls: 'gi-incorrect-hdr' });
                const iconEl = hdr.createDiv({ cls: 'gi-incorrect-icon' });
                setIcon(iconEl, 'x-circle');
                hdr.createEl('span', { text: 'Incorrect', cls: 'gi-incorrect-title' });
                BaseEngine.renderIncorrectContent(
                    app, filePath, compareCard, cloze, rawAnswer.trim(),
                    (wasCorrect) => onComplete(wasCorrect, rawAnswer.trim()),
                    [], dict, cardData
                );
            }
        };
        submitBtn.onclick = () => handleSubmit(inputEl.value);
        inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSubmit(inputEl.value); });

        (container as any)._leafletCleanup = () => {
            ro.disconnect();
            cleanupDrag();
        };
    }

    /**
     * Easy mode: show "Click on: [name]" and let the user click the constellation boundary.
     */
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

        const showLines: boolean = cardData.showLines !== false;
        const featureId: string = cloze.featureId ?? '';
        const correctName: string = Array.isArray(cloze.back) ? (cloze.back[0] ?? featureId) : featureId;

        // Prompt at top
        const promptWrap = container.createDiv({ cls: 'gi-easy-prompt' });
        promptWrap.createEl('span', { text: 'Click on: ', cls: 'gi-easy-prompt-label' });
        promptWrap.createEl('strong', { text: correctName, cls: 'gi-easy-prompt-name' });

        const wrap = container.createDiv({ cls: 'gi-const-wrap' });
        const canvas = wrap.createEl('canvas', { cls: 'gi-const-canvas' });

        const bounds = (boundsGeoJSON as any).features as any[];
        const target = bounds.find((f: any) => f.id === featureId);
        const [cLon0, cLat0] = target ? centroidOf(target) : [0, 0];

        // Start at a neutral view so the target constellation isn't immediately visible
        let viewLon = 0, viewLat = 30, viewZoom = 1;
        let answered = false;
        let revealTarget: string | null = null;
        let revealLabel = '';

        const draw = () => {
            drawSky(canvas, viewLon, viewLat, viewZoom,
                revealTarget, new Set<string>(), showLines,
                revealTarget !== null, revealLabel, new Map());
            if (revealTarget) drawOffscreenArrow(canvas, cLon0, cLat0, viewLon, viewLat, viewZoom);
        };

        const ro = new ResizeObserver(() => draw());
        ro.observe(wrap);
        requestAnimationFrame(draw);
        const fsTarget2 = container.closest('.gi-review-root') as HTMLElement ?? container;
        addFullscreenButton(fsTarget2, draw);

        const [cleanupDrag, wasDragged] = attachDrag(
            canvas,
            () => [viewLon, viewLat, viewZoom],
            (lo, la, zo) => { viewLon = lo; viewLat = la; viewZoom = zo; },
            draw
        );

        canvas.addEventListener('click', (e: MouseEvent) => {
            if (answered || wasDragged()) return;
            const rect = canvas.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;
            const clickedId = hitTestConstellation(px, py, viewLon, viewLat, viewZoom, canvas.clientWidth, canvas.clientHeight);

            answered = true;
            const isCorrect = clickedId === featureId;
            const userAnswer = clickedId ?? '';

            // Pan to the correct constellation's centroid, then reveal it
            if (!isCorrect) { viewLon = cLon0; viewLat = cLat0; }
            revealTarget = featureId;
            revealLabel = isCorrect ? '' : correctName;
            draw();

            promptWrap.remove();

            if (isCorrect) {
                const badge = container.createDiv({ cls: 'gi-easy-badge gi-easy-correct' });
                const iconEl = badge.createDiv();
                setIcon(iconEl, 'check-circle');
                badge.createEl('span', { text: 'Correct!' });
                setTimeout(() => onComplete(true, correctName), 900);
            } else {
                const compareCard = container.createDiv({ cls: 'gi-incorrect-card' });
                const hdr = compareCard.createDiv({ cls: 'gi-incorrect-hdr' });
                const iconEl = hdr.createDiv({ cls: 'gi-incorrect-icon' });
                setIcon(iconEl, 'x-circle');
                hdr.createEl('span', { text: 'Incorrect', cls: 'gi-incorrect-title' });
                BaseEngine.renderIncorrectContent(
                    app, filePath, compareCard, cloze, userAnswer,
                    (wasCorrect) => onComplete(wasCorrect, userAnswer),
                    [], dict, cardData
                );
            }
        });

        (container as any)._leafletCleanup = () => { ro.disconnect(); cleanupDrag(); };
    }

    /**
     * Render a draggable sky preview for the inline inventory-card renderer.
     * Returns a panTo(featureId) function so name chips can fly the view to a constellation.
     */
    static renderPreview(container: HTMLElement, cardData: any): { panTo: (featureId: string) => void } {
        const bounds = (boundsGeoJSON as any).features as any[];
        const showLines: boolean = cardData.showLines !== false;

        const labelMap = new Map<string, string>();
        const highlightIds = new Set<string>();
        for (const cloze of (cardData.clozes || []) as any[]) {
            if (cloze.featureId) {
                labelMap.set(cloze.featureId, cloze.featureId);
                highlightIds.add(cloze.featureId);
            }
        }

        // Start centred on the average of all deck constellations
        let sumLon = 0, sumLat = 0, n = 0;
        for (const f of bounds) {
            if (!highlightIds.has(f.id)) continue;
            const [lo, la] = centroidOf(f);
            sumLon += lo; sumLat += la; n++;
        }
        let viewLon = n ? sumLon / n : 0;
        let viewLat = n ? sumLat / n : 20;
        let viewZoom = 1;

        const canvas = container.createEl('canvas', { cls: 'gi-const-canvas' });

        const draw = () => drawSky(
            canvas, viewLon, viewLat, viewZoom,
            null, highlightIds, showLines,
            false, '', labelMap
        );

        const ro = new ResizeObserver(() => draw());
        ro.observe(container);
        requestAnimationFrame(draw);
        addFullscreenButton(container, draw);

        const [cleanupPreview] = attachDrag(
            canvas,
            () => [viewLon, viewLat, viewZoom],
            (lo, la, zo) => { viewLon = lo; viewLat = la; viewZoom = zo; },
            draw
        );
        (container as any)._leafletCleanup = () => { ro.disconnect(); cleanupPreview(); };

        const panTo = (featureId: string) => {
            const f = bounds.find((b: any) => b.id === featureId);
            if (!f) return;
            const [lo, la] = centroidOf(f);
            viewLon = lo;
            viewLat = la;
            viewZoom = 2.5; // zoom in nicely on the target
            draw();
        };

        return { panTo };
    }
}
