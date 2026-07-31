import type { VisualIR } from '@ui-rebuild/contracts'

function name(value:string){const normalized=value.replaceAll('.','-').replaceAll(/([a-z0-9])([A-Z])/g,'$1-$2').toLowerCase();if(!/^[a-z][a-z0-9-]*$/u.test(normalized))throw new Error(`Unsafe token name: ${value}`);return normalized}
function color(value:string){if(!/^(?:#[0-9a-f]{3,8}|rgba?\([\d.,%\s]+\)|transparent|linear-gradient\([\d.]+deg(?:,\s*(?:#[0-9a-f]{3,8}|rgba?\([\d.,%\s]+\))\s+[\d.]+%){2,}\))$/iu.test(value))throw new Error(`Unsafe color token: ${value}`);return value}
export function logicalPxToRpx(value:number,logicalWidth:number):string{if(!Number.isFinite(logicalWidth)||logicalWidth<=0)throw new Error('logicalWidth must be positive');if(!Number.isFinite(value)||value<0)throw new Error(`Invalid logical pixel value: ${value}`);return `${value*(750/logicalWidth)}rpx`}
export function writeTokens(tokens:VisualIR['tokens'],logicalWidth:number):string{
 const rpx=(value:number)=>logicalPxToRpx(value,logicalWidth)
 const lines=[':root {','  --ui-color-page: #f5f6f8;']
 for(const [key,value] of Object.entries(tokens.colors))lines.push(`  --ui-color-${name(key)}: ${color(value)};`)
 for(const [key,value] of Object.entries(tokens.spacing))lines.push(`  --ui-space-${name(key)}: ${rpx(value)};`)
 for(const [key,value] of Object.entries(tokens.radii))lines.push(`  --ui-radius-${name(key)}: ${rpx(value)};`)
 for(const [key,value] of Object.entries(tokens.typography)){const prefix=`--ui-type-${name(key)}`;lines.push(`  ${prefix}-font-size: ${rpx(value.fontSize)};`);lines.push(`  ${prefix}-font-weight: ${value.fontWeight};`);lines.push(`  ${prefix}-line-height: ${rpx(value.lineHeight)};`);if(value.fontFamily!==undefined)lines.push(`  ${prefix}-font-family: ${value.fontFamily};`)}
 lines.push('}','');return lines.join('\n')
}
