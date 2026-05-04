import { describe, it, expect } from 'vitest';
import { sanitizeSVG } from './svgSanitizer';

// Minimal mock DOM for the test environment
if (typeof (global as any).DOMParser === 'undefined') {
  (global as any).DOMParser = class {
    parseFromString(svg: string, _type: string) {
      const elements: any[] = [];

      const parser = {
        querySelector: (_sel: string) => {
            if (svg.includes('<parsererror')) return { textContent: 'error' };
            return null;
        },
        getElementsByTagName: (_tag: string) => elements,
      };

      // Mocking tags
      const tagRegex = /<([a-z0-9:-]+)(\s+[^>]*?)?(\/?>)/gi;
      let match;
      while ((match = tagRegex.exec(svg)) !== null) {
        const tagName = match[1].toUpperCase();
        const attrString = match[2] || '';

        const attrs: any[] = [];
        const attrRegex = /([a-z0-9:-]+)="([^"]*)"/gi;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrString)) !== null) {
          attrs.push({ name: attrMatch[1], value: attrMatch[2] });
        }

        const el = {
          tagName,
          attributes: attrs,
          parentNode: {
            removeChild: (child: any) => {
              const i = elements.indexOf(child);
              if (i > -1) elements.splice(i, 1);
            }
          },
          removeAttribute: (name: string) => {
            const i = attrs.findIndex(a => a.name === name);
            if (i > -1) attrs.splice(i, 1);
          }
        };
        elements.push(el);
      }

      return parser;
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
  describe('Edge Cases', () => {
    it('should return empty string for null input', () => {
      expect(sanitizeSVG(null as any)).toBe('');
    });

    it('should return empty string for undefined input', () => {
      expect(sanitizeSVG(undefined as any)).toBe('');
    });

    it('should return empty string for non-string input', () => {
      expect(sanitizeSVG(123 as any)).toBe('');
      expect(sanitizeSVG({} as any)).toBe('');
    });

    it('should return empty string for empty string input', () => {
      expect(sanitizeSVG('')).toBe('');
    });

    it('should return empty string for malformed SVG (parsererror)', () => {
      const input = '<parsererror>Error</parsererror>';
      expect(sanitizeSVG(input)).toBe('');
    });
  });

  describe('Tag Sanitization', () => {
    it('should remove dangerous tags', () => {
      const tags = ['script', 'foreignObject', 'iframe', 'video', 'audio'];
      tags.forEach(tag => {
        const input = `<svg><${tag}>content</${tag}></svg>`;
        const output = sanitizeSVG(input);
        expect(output).not.toContain(`<${tag}`);
      });
    });

    it('should be case-insensitive for dangerous tags', () => {
      const input = '<svg><SCRIPT>alert(1)</SCRIPT></svg>';
      const output = sanitizeSVG(input);
      expect(output.toLowerCase()).not.toContain('script');
    });

    it('should preserve safe tags', () => {
      const input = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="red"/></svg>';
      const output = sanitizeSVG(input);
      expect(output).toContain('<svg');
      expect(output).toContain('<circle');
      expect(output).toContain('viewBox="0 0 100 100"');
      expect(output).toContain('fill="red"');
    });
  });

  describe('Attribute Sanitization', () => {
    it('should remove event handlers starting with "on"', () => {
      const input = '<svg><circle onclick="alert(1)" onmouseover="hover()" fill="red"/></svg>';
      const output = sanitizeSVG(input);
      expect(output).not.toContain('onclick');
      expect(output).not.toContain('onmouseover');
      expect(output).toContain('fill="red"');
    });

    it('should be case-insensitive for event handlers', () => {
      const input = '<svg><circle onClick="alert(1)"/></svg>';
      const output = sanitizeSVG(input);
      expect(output.toLowerCase()).not.toContain('onclick');
    });

    it('should remove javascript: URIs in href, xlink:href, and src', () => {
      const attrs = ['href', 'xlink:href', 'src'];
      attrs.forEach(attr => {
        const input = `<svg><a ${attr}="javascript:alert(1)">Link</a></svg>`;
        const output = sanitizeSVG(input);
        expect(output).not.toContain('javascript:');
      });
    });

    it('should remove javascript: URIs with whitespace or mixed case', () => {
      const input = '<svg><a href="  JAVAscript:alert(1) ">Link</a></svg>';
      const output = sanitizeSVG(input);
      expect(output).not.toContain('JAVAscript');
    });

    it('should preserve safe URIs', () => {
      const input = '<svg><a href="https://example.com">Link</a></svg>';
      const output = sanitizeSVG(input);
      expect(output).toContain('href="https://example.com"');
    });
  });

  describe('Nested Elements', () => {
    it('should remove dangerous elements nested inside safe ones', () => {
      const input = '<svg><g><script>alert(1)</script><circle/></g></svg>';
      const output = sanitizeSVG(input);
      expect(output).not.toContain('script');
      expect(output).toContain('<circle');
    });
  });
});
