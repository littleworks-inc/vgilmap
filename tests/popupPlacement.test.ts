import { describe, expect, it } from 'vitest';
import { placePopup } from '../src/utils/popupPlacement';

const MAP = { w: 1120, h: 558 };
const place = (x: number, y: number, h: number, w = 300) => placePopup({ point: { x, y }, map: MAP, popup: { w, h } });

describe('hover popup placement keeps the popup inside the map', () => {
  it('opens below the point when it fits there', () => {
    expect(place(560, 100, 200)).toMatchObject({ anchor: 'top' });
  });
  it('opens above the point when there is no room below but there is above', () => {
    expect(place(560, 480, 200)).toMatchObject({ anchor: 'bottom' });
  });
  it('a tall popup (a cyber event) in the middle of the map opens BESIDE the point, not cut off below it', () => {
    // 356px tall, point halfway down a 558px map: neither 265px above nor below is enough
    const p = place(560, 279, 356);
    expect(p.anchor).toBe('left');
    expect(p.maxHeight).toBeGreaterThanOrEqual(356);
  });
  it('opens to the left of the point when there is no room on its right', () => {
    expect(place(1100, 279, 356).anchor).toBe('right');
  });
  it('grows away from a side edge instead of being centred on the point', () => {
    expect(place(40, 100, 200).anchor).toBe('top-left');
    expect(place(1100, 100, 200).anchor).toBe('top-right');
    expect(place(40, 500, 200).anchor).toBe('bottom-left');
  });
  it('a popup taller than the whole map is shortened to fit rather than cut', () => {
    const p = place(560, 120, 700);
    expect(p.anchor).toBe('top-left');
    expect(p.maxHeight).toBeLessThanOrEqual(MAP.h - 120);
    expect(120 + p.maxHeight).toBeLessThanOrEqual(MAP.h);
  });
  it('the allowed height never lets the popup leave the map, wherever the point is', () => {
    for (const x of [20, 300, 560, 900, 1100]) {
      for (const y of [10, 100, 279, 450, 550]) {
        for (const h of [120, 250, 356, 520, 900]) {
          const p = place(x, y, h);
          const height = Math.min(h, p.maxHeight);
          const top = p.anchor.startsWith('top') ? y : p.anchor.startsWith('bottom') ? y - height : y - height / 2;
          // allow the minimum-height floor (a point at the very edge has no room to give)
          if (p.maxHeight > 80) {
            expect(top, `${x},${y},${h} ${p.anchor}`).toBeGreaterThanOrEqual(0);
            expect(top + height, `${x},${y},${h} ${p.anchor}`).toBeLessThanOrEqual(MAP.h + 1);
          }
        }
      }
    }
  });
});
