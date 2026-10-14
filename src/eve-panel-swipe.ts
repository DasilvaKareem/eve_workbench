/** A deliberate horizontal slide, measured in physical metres along the panel. */
export class PanelSwipe {
  pointerId = -1;
  private x = 0;
  private y = 0;
  private time = 0;

  begin(pointerId: number, x: number, y: number, time: number): boolean {
    if (this.pointerId !== -1 || !Number.isFinite(x + y + time)) return false;
    this.pointerId = pointerId; this.x = x; this.y = y; this.time = time;
    return true;
  }

  end(pointerId: number, x: number, y: number, time: number): -1 | 0 | 1 {
    if (pointerId !== this.pointerId) return 0;
    this.pointerId = -1;
    const dx = x - this.x, dy = y - this.y, duration = time - this.time;
    if (!Number.isFinite(dx + dy + duration) || duration < 60 || duration > 1500
      || Math.abs(dx) < .065 || Math.abs(dx) > .5 || Math.abs(dy) > .06 || Math.abs(dx) < Math.abs(dy) * 1.8) return 0;
    return dx < 0 ? 1 : -1;
  }

  cancel() { this.pointerId = -1; }
}
