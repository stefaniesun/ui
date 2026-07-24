import { access } from 'node:fs/promises'
import path from 'node:path'
export async function reviewPage(root:string){const file=path.resolve(root,'.ui-rebuild','review','report.html');await access(file);return file}
