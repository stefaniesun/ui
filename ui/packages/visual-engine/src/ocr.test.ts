import { describe, expect, it } from 'vitest'
import { LocalOcrCommandProvider, OcrUnavailableError } from './ocr.js'

const item = {
  text: 'Total',
  bounds: { x: 0, y: 0, width: 0.5, height: 0.2 },
  fontSize: null,
  color: null,
  confidence: 0.9,
}

function script(body: string): LocalOcrCommandProvider {
  return new LocalOcrCommandProvider({ command: process.execPath, args: ['-e', body], timeoutMs: 2_000 })
}

describe('LocalOcrCommandProvider', () => {
  it('extracts strict text items through stdin/stdout JSON', async () => {
    const provider = script(`let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>{const input=JSON.parse(data);process.stdout.write(JSON.stringify({items:[{text:input.regionId,bounds:{x:0,y:0,width:0.5,height:0.2},fontSize:null,color:null,confidence:0.9}]}))})`)
    await expect(provider.extract({ regionId: 'hero', image: Buffer.from('png'), width: 20, height: 10 })).resolves.toEqual([
      { ...item, text: 'hero' },
    ])
    expect(provider.identity).toMatchObject({ provider: 'command', schemaVersion: '1.0.0', promptVersion: '1.0.0' })
  })

  it.each([
    `process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('not-json'))`,
    `process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({items:[{text:'x',bounds:{x:2,y:0,width:1,height:1},fontSize:null,color:null,confidence:1}]})))`,
    `process.exit(2)`,
  ])('rejects invalid command behavior %#', async body => {
    await expect(script(body).extract({ regionId: 'hero', image: Buffer.from('png'), width: 20, height: 10 }))
      .rejects.toBeInstanceOf(OcrUnavailableError)
  })

  it('times out and supports cancellation', async () => {
    const provider = new LocalOcrCommandProvider({ command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 10 })
    await expect(provider.extract({ regionId: 'hero', image: Buffer.from('png'), width: 20, height: 10 }))
      .rejects.toThrow('timed out')
    const controller = new AbortController()
    controller.abort()
    await expect(script('setInterval(()=>{},1000)').extract({
      regionId: 'hero', image: Buffer.from('png'), width: 20, height: 10, signal: controller.signal,
    })).rejects.toThrow('cancelled')
  })
})
