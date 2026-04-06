export interface ViewBox {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface PanZoomHandle {
    /** Current viewBox state — read-only outside this module */
    readonly vb: ViewBox;
    /** Convert client (screen) coordinates to SVG document coordinates */
    clientToSVG(clientX: number, clientY: number): { x: number; y: number };
    /** Force the SVG to reflect the current viewBox (call after external vb changes) */
    apply(): void;
    /** Remove all event listeners (call when the SVG is removed from DOM) */
    destroy(): void;
}

/**
 * Attaches pan+zoom behaviour to an inline SVGSVGElement via viewBox manipulation.
 * Pins and overlays that are SVG children automatically follow the viewBox — no
 * coordinate recalculation needed.
 *
 * @param svgEl   The SVG element already in the DOM
 * @param onPin   Optional callback invoked when the user clicks the SVG background
 *                (not on a .svg-pin element) — receives SVG-space coordinates
 */
export function attachPanZoom(
    svgEl: SVGSVGElement,
    onPin?: (svgX: number, svgY: number) => void
): PanZoomHandle {
    // Initialise viewBox from the SVG's own viewBox attribute, or fall back to
    // width/height attributes, or a sensible default.
    const existing = svgEl.viewBox.baseVal;
    const vb: ViewBox = existing.width > 0
        ? { x: existing.x, y: existing.y, w: existing.width, h: existing.height }
        : { x: 0, y: 0, w: svgEl.width.baseVal.value || 800, h: svgEl.height.baseVal.value || 600 };

    function apply() {
        svgEl.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    }
    apply();

    function clientToSVG(clientX: number, clientY: number) {
        const rect = svgEl.getBoundingClientRect();
        return {
            x: vb.x + (clientX - rect.left) * (vb.w / rect.width),
            y: vb.y + (clientY - rect.top)  * (vb.h / rect.height),
        };
    }

    // ── Pan ────────────────────────────────────────────────────────────────
    let isPanning = false;
    let didMove = false;
    let panStart = { clientX: 0, clientY: 0, vbX: 0, vbY: 0 };

    function onPointerDown(e: PointerEvent) {
        // Ignore clicks on pins so they can have their own handlers
        if ((e.target as Element).closest('.svg-pin')) return;
        isPanning = true;
        didMove = false;
        svgEl.setPointerCapture(e.pointerId);
        panStart = { clientX: e.clientX, clientY: e.clientY, vbX: vb.x, vbY: vb.y };
        e.preventDefault();
    }

    function onPointerMove(e: PointerEvent) {
        if (!isPanning) return;
        const rect = svgEl.getBoundingClientRect();
        const sx = vb.w / rect.width;
        const sy = vb.h / rect.height;
        const dx = (e.clientX - panStart.clientX) * sx;
        const dy = (e.clientY - panStart.clientY) * sy;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didMove = true;
        vb.x = panStart.vbX - dx;
        vb.y = panStart.vbY - dy;
        apply();
    }

    function onPointerUp() {
        isPanning = false;
    }

    // ── Zoom ───────────────────────────────────────────────────────────────
    function onWheel(e: WheelEvent) {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1.1 : 0.9;
        const pt = clientToSVG(e.clientX, e.clientY);
        vb.x = pt.x - (pt.x - vb.x) * factor;
        vb.y = pt.y - (pt.y - vb.y) * factor;
        vb.w *= factor;
        vb.h *= factor;
        apply();
    }

    // ── Pin drop (click on background) ────────────────────────────────────
    function onClick(e: MouseEvent) {
        if (!onPin) return;
        if ((e.target as Element).closest('.svg-pin')) return;
        if (didMove) return; // was a pan drag, not a click
        const pt = clientToSVG(e.clientX, e.clientY);
        onPin(pt.x, pt.y);
    }

    svgEl.addEventListener('pointerdown', onPointerDown);
    svgEl.addEventListener('pointermove', onPointerMove);
    svgEl.addEventListener('pointerup',   onPointerUp);
    svgEl.addEventListener('pointercancel', onPointerUp);
    svgEl.addEventListener('wheel', onWheel, { passive: false });
    svgEl.addEventListener('click', onClick);

    function destroy() {
        svgEl.removeEventListener('pointerdown', onPointerDown);
        svgEl.removeEventListener('pointermove', onPointerMove);
        svgEl.removeEventListener('pointerup',   onPointerUp);
        svgEl.removeEventListener('pointercancel', onPointerUp);
        svgEl.removeEventListener('wheel', onWheel);
        svgEl.removeEventListener('click', onClick);
    }

    return { vb, clientToSVG, apply, destroy };
}

// ── SVG pin helpers ────────────────────────────────────────────────────────

const NS = 'http://www.w3.org/2000/svg';

/** Renders a visual pin at (svgX, svgY) inside the given SVG element. */
export function createSVGPin(
    svgEl: SVGSVGElement,
    svgX: number,
    svgY: number,
    label = '?',
    color = 'var(--interactive-accent)'
): SVGGElement {
    const g = document.createElementNS(NS, 'g') as SVGGElement;
    g.setAttribute('class', 'svg-pin');
    g.setAttribute('transform', `translate(${svgX},${svgY})`);

    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('r', '8');
    circle.setAttribute('fill', color);
    circle.setAttribute('stroke', 'white');
    circle.setAttribute('stroke-width', '1.5');

    const text = document.createElementNS(NS, 'text');
    text.setAttribute('y', '-14');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '12');
    text.setAttribute('font-weight', 'bold');
    text.setAttribute('fill', color);
    text.setAttribute('style', 'pointer-events: none; user-select: none;');
    text.textContent = label;

    g.appendChild(circle);
    g.appendChild(text);
    svgEl.appendChild(g);
    return g;
}

/** Removes a pin group from its parent SVG. */
export function removeSVGPin(pin: SVGGElement) {
    pin.parentElement?.removeChild(pin);
}
