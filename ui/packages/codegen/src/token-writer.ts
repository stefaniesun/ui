import type { VisualIR } from '@ui-rebuild/contracts'

function name(value:string){if(!/^[a-z][a-z0-9-]*$/u.test(value))throw new Error(`Unsafe token name: ${value}`);return value}
function color(value:string){if(!/^(?:#[0-9a-f]{3,8}|rgba?\([\d.,%\s]+\)|transparent)$/iu.test(value))throw new Error(`Unsafe color token: ${value}`);return value}
export function writeTokens(tokens:VisualIR['tokens'],logicalWidth:number):string{
 if(!Number.isFinite(logicalWidth)||logicalWidth<=0)throw new Error('logicalWidth must be positive')
 const rpx=(value:number)=>{if(!Number.isFinite(value)||value<0)throw new Error(`Invalid logical pixel token: ${value}`);return `${value*(750/logicalWidth)}rpx`}
 const lines=[':root {','  --ui-color-page: #f5f6f8;']
 for(const [key,value] of Object.entries(tokens.colors))lines.push(`  --ui-color-${name(key)}: ${color(value)};`)
 for(const [key,value] of Object.entries(tokens.spacing))lines.push(`  --ui-space-${name(key)}: ${rpx(value)};`)
 for(const [key,value] of Object.entries(tokens.radii))lines.push(`  --ui-radius-${name(key)}: ${rpx(value)};`)
 for(const [key,value] of Object.entries(tokens.typography))lines.push(`  --ui-type-${name(key)}: ${JSON.stringify(value)};`)
 lines.push('}','');return lines.join('\n')
}
