// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeSVG } from './svgSanitizer';

describe('sanitizeSVG', () => {
  it('returns empty string for invalid inputs', () => {
    expect(sanitizeSVG('')).toBe('');
    expect(sanitizeSVG(null as any)).toBe('');
    expect(sanitizeSVG(undefined as any)).toBe('');
    expect(sanitizeSVG(123 as any)).toBe('');
  });

  it('allows valid SVG without dangerous elements', () => {
    const validSVG = '<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" stroke="green" stroke-width="4" fill="yellow" /></svg>';
    const sanitized = sanitizeSVG(validSVG);
    expect(sanitized).toContain('<circle');
    expect(sanitized).toContain('stroke="green"');
    expect(sanitized).not.toContain('parsererror');
  });

  it('removes <script> tags', () => {
    const svgWithScript = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle cx="50" /></svg>';
    const sanitized = sanitizeSVG(svgWithScript);
    expect(sanitized).not.toContain('<script');
    expect(sanitized).not.toContain('alert');
    expect(sanitized).toContain('<circle');
  });

  it('removes other dangerous tags (foreignObject, iframe, video, audio)', () => {
    const dangerousSVG = `
      <svg xmlns="http://www.w3.org/2000/svg">
        <foreignobject width="100" height="100">
          <body xmlns="http://www.w3.org/1999/xhtml">
            <p>Dangerous</p>
          </body>
        </foreignobject>
        <iframe src="http://example.com"></iframe>
        <video src="video.mp4"></video>
        <audio src="audio.mp3"></audio>
        <rect width="10" height="10" />
      </svg>
    `;
    const sanitized = sanitizeSVG(dangerousSVG);
    expect(sanitized).not.toContain('foreignobject');
    expect(sanitized).not.toContain('iframe');
    expect(sanitized).not.toContain('video');
    expect(sanitized).not.toContain('audio');
    expect(sanitized).toContain('<rect');
  });

  it('removes event handlers (on*)', () => {
    const svgWithEvents = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" onclick="alert(2)"><circle onmouseover="alert(3)" cx="50" /></svg>';
    const sanitized = sanitizeSVG(svgWithEvents);
    expect(sanitized).not.toContain('onload');
    expect(sanitized).not.toContain('onclick');
    expect(sanitized).not.toContain('onmouseover');
    expect(sanitized).not.toContain('alert');
    expect(sanitized).toContain('<svg');
    expect(sanitized).toContain('<circle');
  });

  it('removes javascript: URIs in href, xlink:href, and src attributes', () => {
    const svgWithJsUris = `
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <a href="javascript:alert(1)">Link 1</a>
        <a xlink:href=" javascript:alert(2) ">Link 2</a>
        <image src="javascript:alert(3)" />
        <a href="https://example.com">Safe Link</a>
      </svg>
    `;
    const sanitized = sanitizeSVG(svgWithJsUris);
    expect(sanitized).not.toContain('javascript:alert(1)');
    expect(sanitized).not.toContain('javascript:alert(2)');
    expect(sanitized).not.toContain('javascript:alert(3)');
    expect(sanitized).toContain('href="https://example.com"');
    expect(sanitized).toContain('<a');
    expect(sanitized).toContain('<image');
  });

  it('returns empty string on parser error', () => {
    const invalidXml = '<svg xmlns="http://www.w3.org/2000/svg"><unclosed tag></svg>';
    const sanitized = sanitizeSVG(invalidXml);
    expect(sanitized).toBe('');
  });
});
