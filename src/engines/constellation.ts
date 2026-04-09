import { App, Platform, setIcon } from 'obsidian';
import boundsGeoJSON from '../data/constellations.bounds.json';
import linesGeoJSON from '../data/constellations.lines.json';
import { BaseEngine } from './base-engine';

// stars.6.json has dots in its name so we use require
// eslint-disable-next-line @typescript-eslint/no-var-requires
const starsGeoJSON: any = require('../data/stars.6.json');

function toRad(d: number): number { return d * Math.PI / 180; }

/**
 * Orthographic projection — inside-sphere / sky-view.
 * lon = RA×15°, lat = Dec°.
 * Negating x mirrors East↔West so East is LEFT, matching how the sky looks from Earth.
 */
function proj(
    lon: number, lat: number,
    cLon: number, cLat: number,
    r: number, cx: number, cy: number
): [number, number, number] {
    const φ  = toRad(lat),  λ  = toRad(lon);
    const φ0 = toRad(cLat), λ0 = toRad(cLon);
    const dλ  = λ - λ0;
    const cosφ = Math.cos(φ), sinφ = Math.sin(φ);
    const cosφ0 = Math.cos(φ0), sinφ0 = Math.sin(φ0);
    const x =  cosφ * Math.sin(dλ);
    const y =  cosφ0 * sinφ - sinφ0 * cosφ * Math.cos(dλ);
    const z =  sinφ0 * sinφ + cosφ0 * cosφ * Math.cos(dλ);
    return [cx - x * r, cy - y * r, z]; // -x = inside-sphere (sky) convention
}

function centroidOf(feature: any): [number, number] {
    let sumLon = 0, sumLat = 0, n = 0;
    const geom = feature.geometry;
    const rings: number[][][] = geom.type === 'Polygon'
        ? geom.coordinates
        : (geom.coordinates as number[][][][]).flat(1);
    for (const ring of rings) {
        for (const coord of ring) { sumLon += coord[0] ?? 0; sumLat += coord[1] ?? 0; n++; }
    }
    return n ? [sumLon / n, sumLat / n] : [0, 0];
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
    const visR = Math.min(W, H) / 2 - 4; // visual circle radius (clip + chrome)
    const r    = visR * zoom;              // projection radius (grows with zoom)

    const bounds = (boundsGeoJSON as any).features as any[];
    const lines  = (linesGeoJSON as any).features as any[];
    const stars  = starsGeoJSON.features as any[];

    const p = (lo: number, la: number) =>
        proj(lo, la, viewLon, viewLat, r, cx, cy);

    // ── Sky dome ─────────────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.arc(cx, cy, visR, 0, Math.PI * 2);
    ctx.fillStyle = '#060d1a';
    ctx.fill();

    // ── Clip everything inside the circle ─────────────────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, visR, 0, Math.PI * 2);
    ctx.clip();

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
                    const [sx, sy] = p(coord[0] ?? 0, coord[1] ?? 0);
                    if (first) { ctx.moveTo(sx, sy); first = false; }
                    else ctx.lineTo(sx, sy);
                }
                ctx.closePath();
                ctx.stroke();
            }
        }
    }

    // ── Stars ─────────────────────────────────────────────────────────────────
    for (const f of stars) {
        const coords = f.geometry.coordinates as number[];
        const lo = coords[0] ?? 0, la = coords[1] ?? 0;
        const [sx, sy, z] = p(lo, la);
        if (z < 0) continue;
        const mag: number = f.properties.mag ?? 5;
        // Size: Sirius ~3.5px, mag 6 → 0.5px
        const sr = Math.max(0.5, (6.5 - mag) * 0.45);
        // Alpha: brightest = 1.0, dimmest = 0.4
        const alpha = Math.min(1, 0.4 + (6.5 - mag) / 7.5);
        // B-V tint: hot stars are blue-white, cool stars are warm-orange
        const bv: number = parseFloat(f.properties.bv) || 0;
        const rr = Math.round(Math.min(255, 195 + bv * 12));
        const gg = Math.round(Math.min(255, 210 - bv * 4));
        const bb = Math.round(Math.min(255, 255 - bv * 22));
        // Glow for bright stars (mag < 2)
        if (mag < 2) {
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
                        const [sx, sy] = p(coord[0] ?? 0, coord[1] ?? 0);
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

    // ── Preview mode: name labels for included constellations ─────────────────
    if (labelMap.size > 0) {
        const fontSize = Math.max(7, Math.round(r / 22));
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

    ctx.restore(); // end clip

    // ── Limb vignette + rim (always at visual circle, not zoomed radius) ────────
    ctx.save();
    const grad = ctx.createRadialGradient(cx, cy, visR * 0.80, cx, cy, visR);
    grad.addColorStop(0, 'rgba(6,13,26,0)');
    grad.addColorStop(1, 'rgba(3,7,16,0.70)');
    ctx.beginPath();
    ctx.arc(cx, cy, visR, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,70,130,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
}

/** Attach drag-to-rotate interaction to a canvas.
 *  Returns a cleanup function (call when the view is destroyed). */
function attachDrag(
    canvas: HTMLCanvasElement,
    getView: () => [number, number, number],  // [lon, lat, zoom]
    setView: (lon: number, lat: number, zoom: number) => void,
    redraw: () => void
): () => void {
    let dragging = false, lastX = 0, lastY = 0;
    // Pinch-zoom state
    let lastPinchDist = 0;

    const startDrag = (cx: number, cy: number) => { dragging = true; lastX = cx; lastY = cy; };
    const moveDrag  = (cx: number, cy: number) => {
        if (!dragging) return;
        const dx = cx - lastX, dy = cy - lastY;
        lastX = cx; lastY = cy;
        const [lon, lat, zoom] = getView();
        const rr = (Math.min(canvas.clientWidth, canvas.clientHeight) / 2 - 4) * zoom;
        let newLon = lon + (dx / rr) * (180 / Math.PI);
        const newLat = Math.max(-90, Math.min(90, lat - (dy / rr) * (180 / Math.PI)));
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

    return () => {
        canvas.removeEventListener('wheel', onWheel);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup',   endDrag);
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend',  endDrag);
    };
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

        const showLines: boolean = cardData.showLines !== false;
        const featureId: string = cloze.featureId ?? '';

        container.createEl('h3', {
            text: cloze.front || 'Name this constellation',
            attr: { style: 'text-align:center; margin-bottom:8px;' }
        });

        const wrap = container.createDiv({ cls: 'gi-const-wrap' });
        const canvas = wrap.createEl('canvas', { cls: 'gi-const-canvas' });

        const bounds = (boundsGeoJSON as any).features as any[];
        const target = bounds.find((f: any) => f.id === featureId);
        const [cLon0, cLat0] = target ? centroidOf(target) : [0, 0];

        let viewLon = cLon0, viewLat = cLat0, viewZoom = 1;
        let revealed = false, revealName = '';

        const draw = () => drawSky(
            canvas, viewLon, viewLat, viewZoom,
            featureId, new Set<string>(), showLines,
            revealed, revealName, new Map()
        );

        const ro = new ResizeObserver(() => draw());
        ro.observe(wrap);
        requestAnimationFrame(draw);

        const cleanupDrag = attachDrag(
            canvas,
            () => [viewLon, viewLat, viewZoom],
            (lo, la, zo) => { viewLon = lo; viewLat = la; viewZoom = zo; },
            draw
        );

        (container as any)._leafletCleanup = () => {
            ro.disconnect();
            cleanupDrag();
        };

        // ── Input ─────────────────────────────────────────────────────────────
        let inputEl: HTMLInputElement;
        let floatingOverlay: HTMLElement | null = null;

        if (Platform.isMobile) {
            floatingOverlay = document.body.createDiv({ cls: 'gi-floating-input-overlay' });
            floatingOverlay.createEl('span', {
                text: cloze.front || 'Answer:',
                cls: 'gi-floating-input-prompt'
            });
            inputEl = floatingOverlay.createEl('input', {
                type: 'text',
                placeholder: 'Type constellation name…',
                cls: 'gi-floating-input'
            });
        } else {
            inputEl = container.createEl('input', {
                type: 'text',
                placeholder: 'Type constellation name…',
                cls: 'gi-map-answer-input'
            });
        }

        setTimeout(() => inputEl.focus(), 100);

        const handleSubmit = (rawAnswer: string) => {
            const userAnswer = rawAnswer.trim().toLowerCase();
            const correctAnswers = (cloze.back || []).map((a: string) => a.toLowerCase());
            const isCorrect = correctAnswers.includes(userAnswer);

            if (floatingOverlay) { floatingOverlay.remove(); floatingOverlay = null; }
            else inputEl.remove();

            if (isCorrect) {
                onComplete(true, rawAnswer.trim());
            } else {
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

        inputEl.onkeydown = (e) => {
            if (e.key === 'Enter') handleSubmit(inputEl.value);
        };
    }

    /**
     * Render a draggable globe preview for the inline inventory-card renderer.
     * Shows all constellations in the deck labeled; no target highlighted.
     */
    static renderPreview(container: HTMLElement, cardData: any): void {
        const bounds = (boundsGeoJSON as any).features as any[];
        const showLines: boolean = cardData.showLines !== false;

        // Build label map: featureId → abbreviation (use abbr for space)
        const labelMap = new Map<string, string>();
        const highlightIds = new Set<string>();
        for (const cloze of (cardData.clozes || []) as any[]) {
            if (cloze.featureId) {
                labelMap.set(cloze.featureId, cloze.featureId); // 3-letter abbr
                highlightIds.add(cloze.featureId);
            }
        }

        // Compute center: average centroid of all deck constellations
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

        attachDrag(
            canvas,
            () => [viewLon, viewLat, viewZoom],
            (lo, la, zo) => { viewLon = lo; viewLat = la; viewZoom = zo; },
            draw
        );
    }
}
