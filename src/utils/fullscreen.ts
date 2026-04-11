import { setIcon } from 'obsidian';

/**
 * Adds a small fullscreen-toggle button to the top-right corner of wrapEl.
 * wrapEl must have position:relative (or absolute/fixed) so the button anchors correctly.
 * onResize() is called after every fullscreen transition so maps/canvases can refresh.
 */
export function addFullscreenButton(wrapEl: HTMLElement, onResize: () => void): void {
    const btn = document.createElement('div');
    btn.className = 'gi-fullscreen-btn';
    wrapEl.appendChild(btn);
    setIcon(btn as any, 'maximize-2');

    const onFsChange = () => {
        const isFs = document.fullscreenElement === wrapEl;
        btn.empty();
        setIcon(btn as any, isFs ? 'minimize-2' : 'maximize-2');
        // Double-rAF: first frame commits the resize, second frame lets the browser
        // finish painting so map/canvas dimensions are correct.
        requestAnimationFrame(() => requestAnimationFrame(onResize));
    };

    btn.onclick = (e: MouseEvent) => {
        e.stopPropagation();
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        } else {
            wrapEl.requestFullscreen().catch(() => {});
        }
    };

    document.addEventListener('fullscreenchange', onFsChange);

    // Remove the listener when wrapEl is detached from the document
    const mo = new MutationObserver(() => {
        if (!document.body.contains(wrapEl)) {
            document.removeEventListener('fullscreenchange', onFsChange);
            mo.disconnect();
        }
    });
    mo.observe(document.body, { childList: true, subtree: true });
}
