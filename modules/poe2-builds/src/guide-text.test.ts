import { expect, it } from 'vitest';
import { guideTextMarkup } from './guide-text';
it('links web URLs without losing surrounding punctuation or original text',()=>{
 const markup=guideTextMarkup('Guide: https://example.org/a?x=1&y=2. Next (https://example.org/tree).');
 expect(markup).toContain('href="https://example.org/a?x=1&amp;y=2"');
 expect(markup).toContain('href="https://example.org/tree"');expect(markup).toContain('</a>).');
 expect(guideTextMarkup('https://example.org/a(b)')).toContain('href="https://example.org/a(b)"');
});
it('escapes guide markup, never creates non-web or credential links, and keeps plain text',()=>{
 const markup=guideTextMarkup('<script>bad()</script> javascript:alert(1) file:///secret https://user:pass@example.org/a');
 expect(markup).toContain('&lt;script&gt;');expect(markup).not.toContain('<a ');
 expect(guideTextMarkup('Original wording.')).toBe('Original wording.');
});
