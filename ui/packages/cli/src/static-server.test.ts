import { mkdtemp,writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe,expect,it } from 'vitest'
import { startStaticServer } from './static-server.js'
describe('static server',()=>{it('serves build files only from loopback root',async()=>{const root=await mkdtemp(path.join(os.tmpdir(),'ui-static-'));await writeFile(path.join(root,'index.html'),'ok');const server=await startStaticServer(root);try{await expect(fetch(server.url).then(r=>r.text())).resolves.toBe('ok');await expect(fetch(`${server.url}/../secret`).then(r=>r.status)).resolves.toBe(404)}finally{await server.close()}})})
