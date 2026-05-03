import { describe, it, expect } from 'vitest';
import { sanitizeSVG } from './svgSanitizer';

// Minimal mock DOM for the test environment
// In a proper environment, vitest would be configured with jsdom.
if (typeof (global as any).DOMParser === 'undefined') {
  (global as any).DOMParser = class {
    parseFromString(svg: string) {
      const elements: any[] = [];

      // Manual extraction of tag names and attributes from common test cases
      if (svg.includes('<script')) {
        elements.push({
          tagName: 'SCRIPT',
          attributes: [],
          parentNode: { removeChild: (child: any) => {
            const i = elements.indexOf(child);
            if (i > -1) elements.splice(i, 1);
          }}
        });
      }
      if (svg.includes('<circle')) {
        const attrs: any[] = [];
        if (svg.includes('onclick')) attrs.push({ name: 'onclick', value: '...' });
        if (svg.includes('fill="red"')) attrs.push({ name: 'fill', value: 'red' });
        elements.push({
          tagName: 'CIRCLE',
          attributes: attrs,
          removeAttribute: (name: string) => {
            const i = attrs.findIndex(a => a.name === name);
            if (i > -1) attrs.splice(i, 1);
          }
        });
      }
      if (svg.includes('<a href="javascript:')) {
        const attrs = [{ name: 'href', value: 'javascript:alert(1)' }];
        elements.push({
          tagName: 'A',
          attributes: attrs,
          removeAttribute: (name: string) => {
             const i = attrs.findIndex(a => a.name === name);
             if (i > -1) attrs.splice(i, 1);
          }
        });
      }

      return {
        querySelector: () => null,
        getElementsByTagName: () => elements,
      };
    }
  };
}

if (typeof (global as any).XMLSerializer === 'undefined') {
  (global as any).XMLSerializer = class {
    serializeToString(doc: any) {
      let res = '';
      for (const el of doc.getElementsByTagName('*')) {
        res += `<${el.tagName.toLowerCase()}`;
        for (const attr of el.attributes) {
          res += ` ${attr.name}="${attr.value}"`;
        }
        res += '/>';
      }
      return res;
    }
  };
}

describe('sanitizeSVG', () => {
  it('should remove scripts', () => {
    const input = '<svg><script>alert(1)</script></svg>';
    const output = sanitizeSVG(input);
    expect(output).not.toContain('script');
  });

  it('should remove event handlers', () => {
    const input = '<svg><circle onclick="alert(1)" fill="red"/></svg>';
    const output = sanitizeSVG(input);
    expect(output).not.toContain('onclick');
    expect(output).toContain('fill="red"');
  });

  it('should remove javascript URIs', () => {
    const input = '<svg><a href="javascript:alert(1)"></a></svg>';
    const output = sanitizeSVG(input);
    expect(output).not.toContain('javascript');
  });
});
