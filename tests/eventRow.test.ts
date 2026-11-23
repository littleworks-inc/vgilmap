import { describe, expect, it } from 'vitest';
import { eventRowTitle } from '../src/utils/eventRow';

describe('event row hover text says what a click does', () => {
  it('a plotted event shows on the globe', () => {
    expect(eventRowTitle({ unmapped: false, incident: false, expanded: false })).toMatch(/globe/);
  });
  it('an event with no location opens its details instead, and says why', () => {
    expect(eventRowTitle({ unmapped: true, incident: false, expanded: false })).toMatch(/no map location/);
    expect(eventRowTitle({ unmapped: true, incident: false, expanded: true })).toMatch(/Hide/);
  });
  it('a plotted incident shows on the globe and toggles its reports', () => {
    expect(eventRowTitle({ unmapped: false, incident: true, expanded: false })).toMatch(/globe.*reports/);
    expect(eventRowTitle({ unmapped: false, incident: true, expanded: true })).toMatch(/hide its reports/);
  });
});
