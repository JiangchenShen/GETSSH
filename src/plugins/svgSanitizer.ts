const DANGEROUS_TAGS = new Set(['script', 'foreignobject', 'iframe', 'video', 'audio']);
const SAFE_URL_ATTRS = new Set(['href', 'xlink:href', 'src']);

/** Strip potentially dangerous attributes from SVG icons */
export function sanitizeSVG(svg: string): string {
  if (!svg || typeof svg !== 'string') return '';

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svg, 'image/svg+xml');

    // Check for parsing errors
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      console.warn('[PluginBridge] SVG parsing error:', parserError.textContent);
      return '';
    }

    const elements = doc.getElementsByTagName('*');
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];

      // Remove <script> and other dangerous tags
      if (DANGEROUS_TAGS.has(el.tagName.toLowerCase())) {
        el.parentNode?.removeChild(el);
        i--;
        continue;
      }

      // Remove all event handlers (on*)
      const attrs = el.attributes;
      for (let j = 0; j < attrs.length; j++) {
        const attrName = attrs[j].name.toLowerCase();
        if (attrName.startsWith('on')) {
          el.removeAttribute(attrs[j].name);
          j--;
        } else if (SAFE_URL_ATTRS.has(attrName)) {
          // Remove javascript: URIs
          const value = attrs[j].value.toLowerCase().trim();
          if (value.startsWith('javascript:')) {
            el.removeAttribute(attrs[j].name);
            j--;
          }
        }
      }
    }

    return new XMLSerializer().serializeToString(doc);
  } catch (e) {
    console.error('[PluginBridge] Failed to sanitize SVG:', e);
    return '';
  }
}
