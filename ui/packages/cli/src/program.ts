import { Command } from 'commander'
import { analyzePage } from './commands/analyze.js'
import { doctor } from './commands/doctor.js'
import { initPage } from './commands/init.js'
import { reviewPage } from './commands/review.js'
import { runPage } from './commands/run.js'
import path from 'node:path'
const invocationCwd=()=>process.env.INIT_CWD??process.cwd()
const resolveRoot=(value:string)=>path.resolve(invocationCwd(),value)
export function createCli(){const cli=new Command('ui-rebuild');cli.command('doctor').action(async()=>console.table(await doctor(invocationCwd())));cli.command('init <page>').action(async page=>console.log(await initPage(page,invocationCwd())));cli.command('analyze <root>').action(async root=>console.log(JSON.stringify(await analyzePage(resolveRoot(root)),null,2)));cli.command('run <root>').option('--max-rounds <number>','maximum rounds','8').option('--resume <runId>').action(async(root,o)=>console.log(await runPage(resolveRoot(root),{maxRounds:Number(o.maxRounds),resume:o.resume})));cli.command('review <root>').action(async root=>console.log(await reviewPage(resolveRoot(root))));return cli}
