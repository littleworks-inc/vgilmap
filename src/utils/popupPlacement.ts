/**
 * Where a hover popup should open relative to the point under the mouse, so it stays inside the map.
 *
 * MapLibre's own automatic choice only asks "is the point in the top or bottom half?", so a popup taller
 * than half the map (cyber popups are about 350px) is cut off whichever way it opens. This picks the side
 * with room, opens BESIDE the point when neither above nor below fits, and says how tall the popup may be.
 */
export type Anchor = 'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface Placement {
  /** The popup edge or corner that touches the point (MapLibre's meaning: 'top' = popup opens below it). */
  anchor: Anchor;
  /** The tallest the popup may be in that position without leaving the map. */
  maxHeight: number;
}

interface Size { w: number; h: number }

const MIN_HEIGHT = 80;

export function placePopup({ point, map, popup, gap = 16, margin = 8 }: {
  point: { x: number; y: number };
  map: Size;
  popup: Size;
  /** Room kept between the point and the popup (the marker, the arrow). */
  gap?: number;
  /** Room kept between the popup and the map's edge. */
  margin?: number;
}): Placement {
  const below = map.h - point.y - gap;
  const above = point.y - gap;
  const result = (anchor: Anchor, room: number): Placement => ({ anchor, maxHeight: Math.max(MIN_HEIGHT, Math.floor(room)) });

  // Near a side edge the popup must grow away from it instead of being centred on the point.
  const horiz = point.x < popup.w / 2 + margin ? '-left' : point.x > map.w - popup.w / 2 - margin ? '-right' : '';

  if (popup.h <= below) return result(`top${horiz}` as Anchor, below - margin);
  if (popup.h <= above) return result(`bottom${horiz}` as Anchor, above - margin);

  // Taller than the room above or below: open beside the point. 'left' = the popup's left edge is at the point.
  const roomRight = map.w - point.x - gap;
  const side = roomRight >= popup.w || roomRight >= point.x - gap ? 'left' : 'right';
  const centred = 2 * Math.min(point.y, map.h - point.y) - 2 * margin;
  if (popup.h <= centred) return result(side, centred);
  // Not even centred: hang it from the roomier half and let it be shorter.
  return point.y < map.h / 2
    ? result(`top-${side}` as Anchor, map.h - point.y - margin)
    : result(`bottom-${side}` as Anchor, point.y - margin);
}
