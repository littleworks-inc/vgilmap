import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'public/manifest.webmanifest'), 'utf8'));
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const onDisk = (url: string) => path.join(ROOT, 'public', url.replace(/^\//, ''));

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): [number, number] {
  const b = readFileSync(file);
  expect(b.subarray(1, 4).toString()).toBe('PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe('web app manifest', () => {
  it('has what browsers need to offer "install"', () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });
  it('every icon exists and is the size it claims', () => {
    for (const icon of manifest.icons as Array<{ src: string; sizes: string; type: string }>) {
      expect(existsSync(onDisk(icon.src)), icon.src).toBe(true);
      if (icon.type === 'image/png') {
        const [w, h] = pngSize(onDisk(icon.src));
        expect(`${w}x${h}`, icon.src).toBe(icon.sizes);
      }
    }
  });
  it('has the 192 and 512 icons Chrome requires, and a maskable one', () => {
    const has = (sizes: string, purpose: string) => manifest.icons.some((i: { sizes: string; purpose?: string }) => i.sizes === sizes && (i.purpose ?? 'any') === purpose);
    expect(has('192x192', 'any')).toBe(true);
    expect(has('512x512', 'any')).toBe(true);
    expect(has('512x512', 'maskable')).toBe(true);
  });
  it('shortcuts open real views', () => {
    for (const s of manifest.shortcuts as Array<{ url: string; icons: Array<{ src: string }> }>) {
      expect(s.url.startsWith('/')).toBe(true);
      for (const i of s.icons) expect(existsSync(onDisk(i.src)), i.src).toBe(true);
    }
    expect(manifest.shortcuts.map((s: { url: string }) => s.url)).toContain('/?view=today');
  });
  it('index.html links the manifest and the icons, and its theme colour matches', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('rel="apple-touch-icon" href="/icons/apple-touch-icon.png"');
    expect(existsSync(onDisk('/icons/apple-touch-icon.png'))).toBe(true);
    expect(html).toContain(`<meta name="theme-color" content="${manifest.theme_color}"`);
  });
});
