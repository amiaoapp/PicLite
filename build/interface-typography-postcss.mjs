// Scale UI text only. Do not change layout dimensions or canvas pixels.
export default function interfaceTypography() {
  return {
    postcssPlugin: 'piclite-interface-typography',
    Declaration(decl) {
      if (decl.prop === 'font-size' && /(?:px|rem|vw|vh|cqw)/i.test(decl.value) && !decl.value.includes('--interface-font-scale')) {
        decl.value = `calc((${decl.value}) * var(--interface-font-scale, 1))`;
      } else if (decl.prop === 'font' && !decl.value.includes('--interface-font-scale')) {
        decl.value = decl.value.replace(/(\d*\.?\d+(?:px|rem|vw|vh|cqw))(?=\s|\/|$)/i, size => `calc(${size} * var(--interface-font-scale, 1))`);
      }
    },
  };
}
interfaceTypography.postcss = true;
