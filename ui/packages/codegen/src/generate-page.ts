import { VisualIRSchema, isSafeProjectRelativePath } from '@ui-rebuild/contracts'
import type { RegionNode, VisualIRInput } from '@ui-rebuild/contracts'
import { writeAssetRegistry } from './asset-registry.js'
import { assertHealthyGeneratedFiles } from './component-policy.js'
import { writeTokens } from './token-writer.js'

export interface GenerateOptions { logicalWidth:number; assets?:Array<{key:string;path:string}> }
const pascal=(v:string)=>{const r=v.split('-').map(p=>p[0]!.toUpperCase()+p.slice(1)).join('');if(!/^[A-Z][A-Za-z0-9]*$/u.test(r))throw new Error(`Unsafe component name: ${v}`);return r}
const escape=(v:string)=>v.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')
function pathFor(region:RegionNode,pageId:string,name:string){const v=region.componentPath??`src/components/${pageId}/${name}.vue`;if(!isSafeProjectRelativePath(v)||!v.startsWith('src/components/')||!v.endsWith('.vue'))throw new Error(`Unsafe componentPath: ${v}`);return v.replaceAll('\\','/')}
function relativeImport(from:string,to:string){const fromParts=from.split('/').slice(0,-1);const toParts=to.split('/');while(fromParts[0]===toParts[0]){fromParts.shift();toParts.shift()}return `${'../'.repeat(fromParts.length)}${toParts.join('/').replace(/\.vue$/u,'')}`}
function component(region:RegionNode,children:RegionNode[],currentPath:string){const imports=children.map(c=>`import ${pascal(c.regionId)} from '${relativeImport(currentPath,pathFor(c,'unused',pascal(c.regionId)))}'`).join('\n');const tags=children.map(c=>`    <${pascal(c.regionId)} />`).join('\n');return `<script setup lang="ts">\n${imports}\n</script>\n<template>\n  <view class="semantic-region" data-region-id="${region.regionId}" aria-label="${escape(region.displayName)}">\n${tags}\n  </view>\n</template>\n<style scoped lang="scss">.semantic-region{display:flex;flex-direction:column;gap:var(--ui-space-page);background:var(--ui-color-surface)}</style>\n`}
export function generatePage(input:VisualIRInput,options:GenerateOptions):Record<string,string>{
 const ir=VisualIRSchema.parse(input);if(!/^[a-z][a-z0-9-]*$/u.test(ir.pageId))throw new Error(`Unsafe pageId: ${ir.pageId}`)
 const files:Record<string,string>={};const names=new Set<string>();const paths=new Map<string,string>()
 for(const region of ir.regions){const n=pascal(region.regionId);if(names.has(n))throw new Error(`Component name collision: ${n}`);names.add(n);paths.set(region.regionId,pathFor(region,ir.pageId,n))}
 for(const region of ir.regions){const p=paths.get(region.regionId)!;files[p]=component(region,ir.regions.filter(c=>c.parentId===region.regionId),p)}
 const pagePath=`src/pages/${ir.pageId}/index.vue`;const roots=ir.regions.filter(r=>r.parentId===null);const imports=roots.map(r=>`import ${pascal(r.regionId)} from '${relativeImport(pagePath,paths.get(r.regionId)!)}'`).join('\n');const tags=roots.map(r=>`    <${pascal(r.regionId)} />`).join('\n')
 files[pagePath]=`<script setup lang="ts">\n${imports}\n</script>\n<template><view class="page-${ir.pageId}">\n${tags}\n</view></template>\n<style scoped lang="scss">.page-${ir.pageId}{min-height:100vh;padding:var(--ui-space-page);background:var(--ui-color-page)}</style>\n`
 files['src/styles/tokens.scss']=writeTokens(ir.tokens,options.logicalWidth);files['src/assets/registry.ts']=writeAssetRegistry(options.assets??[]);assertHealthyGeneratedFiles(files);return files
}
