import { access } from 'node:fs/promises'
import path from 'node:path'
import { parseTrustedOrigins } from '../runtime.js'

export async function doctor(cwd=process.cwd()) {
  const checks=[]
  checks.push({name:'node',ok:Number(process.versions.node.split('.')[0])>=22,detail:process.versions.node})
  const browsers=process.env.PLAYWRIGHT_BROWSERS_PATH??path.join(cwd,'.cache','ms-playwright')
  checks.push({name:'chromium',ok:await exists(browsers),detail:browsers})
  const baseUrl=process.env.UI_REBUILD_MODEL_BASE_URL,model=process.env.UI_REBUILD_MODEL
  checks.push({name:'model',ok:Boolean(baseUrl&&model),detail:baseUrl&&model?`${model} @ ${baseUrl}`:'UI_REBUILD_MODEL_BASE_URL 或 UI_REBUILD_MODEL 未配置'})
  let extractionOk=Boolean(process.env.UI_REBUILD_OCR_COMMAND)
  let extractionDetail=process.env.UI_REBUILD_OCR_COMMAND?`命令后备：${process.env.UI_REBUILD_OCR_COMMAND}`:'多模态模型配置无效'
  if(!extractionOk&&baseUrl&&model){try{const endpoint=new URL(baseUrl),trusted=parseTrustedOrigins(process.env.UI_REBUILD_MODEL_TRUSTED_ORIGINS);const loopback=['127.0.0.1','localhost','::1'].includes(endpoint.hostname);extractionOk=loopback||(endpoint.protocol==='https:'&&trusted.includes(endpoint.origin));extractionDetail=extractionOk?`模型提取：${model}`:`远程模型 Origin 未受信任：${endpoint.origin}`}catch(error){extractionDetail=error instanceof Error?error.message:'模型配置无效'}}
  checks.push({name:'text-extraction',ok:extractionOk,detail:extractionDetail})
  const wechat=process.env.WECHAT_DEVTOOLS_CLI
  checks.push({name:'wechat-devtools',ok:Boolean(wechat&&await exists(wechat)),detail:wechat??'WECHAT_DEVTOOLS_CLI 未配置'})
  return checks
}
async function exists(value:string){try{await access(value);return true}catch{return false}}
