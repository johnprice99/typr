// The palette and the About panel are overlays; only one is ever up at a time.

let current: (() => void) | null = null

/** Shows an overlay, closing whichever one was up. `close` must remove it. */
export function claimOverlay(close: () => void): void {
  const prev = current
  current = close
  if (prev && prev !== close) prev()
}

/** An overlay has closed. */
export function releaseOverlay(close: () => void): void {
  if (current === close) current = null
}
