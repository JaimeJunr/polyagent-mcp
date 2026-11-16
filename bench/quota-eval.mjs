import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { summarizeEvents, answerMatches, pairedSummary, trialAccepted, parseRepetitions } from './quota-eval-core.mjs';
import { ARMS, HOST_MODEL, HOST_EFFORT, REPETITIONS, TASKS, createFixtures, ledgerCheckScript } from './quota-eval-fixtures.mjs';
import { BATCH_TASK, createBatchFixture, batchCheckScript } from './quota-batch-fixture.mjs';
import { TINY_TASK, MEDIUM_TASK, createSizeFixture, tinyCheckScript, mediumCheckScript } from './quota-size-fixtures.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = join(ROOT,'runtime');
const FOCUSED = process.env.QUOTA_FOCUSED === '1';
// Curva de tamanho (tiny → implement → medium → batch): acha a partir de que tamanho de tarefa
// delegar antes de explorar compensa, em vez de só os dois pontos (implement, batch) do piloto original.
const REPS = parseRepetitions(process.env.QUOTA_REPETITIONS, REPETITIONS);
const SIZE_FOCUSED = process.env.QUOTA_SIZE_FOCUSED === '1';
const TASK_SET = SIZE_FOCUSED ? [TINY_TASK,TASKS[2],MEDIUM_TASK,BATCH_TASK] : FOCUSED ? [TASKS[2],BATCH_TASK] : TASKS;
const ARM_SET = SIZE_FOCUSED ? ['lean','coarse'] : FOCUSED ? ['lean','coarse','slim'] : ARMS;
const COMPARISONS = SIZE_FOCUSED ? [['lean','coarse']] : FOCUSED ? [['lean','coarse'],['lean','slim'],['coarse','slim']] : [['habitual-instructions','lean'],['lean','bridge'],['lean','coarse']];
const OUT = join(ROOT,SIZE_FOCUSED ? 'output-size' : FOCUSED ? 'output-focused' : 'output');
const LEAN = 'Complete only the requested task. Use efficient native tools when appropriate. Do not commit, push, contact external services, or change files outside this workspace. Return the requested JSON. For edits, first run a failing behavior test, then fix and rerun. Tool and worker claims require verification.';
const COARSE = 'For this trial, before reading or searching source or running the task command, delegate the entire task once with mcp__polyagent__delegate, level:"low", engine:"codex", model:"gpt-6-luna", effort:"medium", and cwd equal to this workspace. Include the complete task and requested JSON in its prompt. After the worker returns, verify the concrete answer or changed behavior with one targeted native check, then return the requested JSON. Do not repeat its exploration.';
const SLIM = 'For this trial, before reading or searching source, delegate the entire task once using mcp__polyagent__delegate with a complete prompt. The tool already fixes the workspace and Codex model. After it returns, verify the changed behavior with one targeted native check, then return the requested JSON. Do not repeat its exploration.';

/** @param {string} path */
function jsonLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path,'utf8').split('\n').filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

/** @param {string} directory */
function transcriptFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry => {
    const path = join(directory,entry.name);
    return entry.isDirectory() ? transcriptFiles(path) : entry.name.endsWith('.jsonl') ? [path] : [];
  });
}

/** @param {string[]} handles */
function workerUsage(handles) {
  return handles.map(handle => {
    const [engine,id] = handle.split(':');
    const directory = engine === 'codex' ? join(process.env.HOME,'.codex/sessions') : join(process.env.HOME,'.claude/projects');
    const files = transcriptFiles(directory).filter(path => path.includes(id));
    if (engine === 'claude') {
      const usage = summarizeEvents(files.flatMap(jsonLines));
      return {engine,found:files.length > 0,tokens:usage.tokens,costUsd:null};
    }
    let total = null;
    for (const file of files) for (const event of jsonLines(file)) {
      if (event.type === 'event_msg' && event.payload?.type === 'token_count' && event.payload.info?.total_token_usage) total = event.payload.info.total_token_usage;
    }
    return {engine,found:files.length > 0,tokens:total,costUsd:null};
  });
}

/** @param {string[]} args @param {string} cwd @param {string} eventPath */
function runHost(args,cwd,eventPath) {
  return new Promise(resolveRun => {
    const child = spawn('claude',args,{cwd,stdio:['ignore','pipe','pipe'],env:{...process.env,CLAUDE_CODE_DISABLE_CLAUDE_MDS:'1',CLAUDE_CODE_DISABLE_AUTO_MEMORY:'1'}});
    let stdout = ''; let stderr = ''; let timedOut = false;
    child.stdout.on('data',chunk => { stdout += chunk; });
    child.stderr.on('data',chunk => { stderr += chunk; });
    // Mesmo teto de segurança do eval existente; não é evidência de conclusão.
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); },8 * 60 * 1000);
    child.on('error',error => { stderr += error.message; });
    child.on('close',code => {
      clearTimeout(timer);
      writeFileSync(eventPath,stdout,{mode:0o600});
      resolveRun({code,timedOut,stderr,events:jsonLines(eventPath)});
    });
  });
}

/** @param {string} arm @param {Record<string, unknown>} task @param {number} rep */
async function attempt(arm,task,rep) {
  const trial = `${rep}-${task.id}-${arm}`;
  const workspace = join(ROOT,SIZE_FOCUSED ? 'workspaces-size' : FOCUSED ? 'workspaces-focused' : 'workspaces',trial);
  if (task.id === 'batch') createBatchFixture(workspace);
  else if (task.id === 'tiny' || task.id === 'medium') createSizeFixture(workspace,task.project);
  else createFixtures(workspace,ROOT,task.project);
  const context = arm === 'habitual-instructions' ? readFileSync(join(ROOT,'habitual-instructions.txt'),'utf8') : LEAN;
  const withBridge = arm === 'bridge' || arm === 'coarse' || arm === 'slim';
  const log = join(workspace,'bridge-usage.jsonl');
  const config = {mcpServers:withBridge ? {polyagent:{command:process.execPath,args:[join(RUNTIME,'dist/index.js')],env:{POLYAGENT_CLAUDE_MD:'off',POLYAGENT_LOG:log,POLYAGENT_CODEX_BIN:process.env.QUOTA_CODEX_BIN,POLYAGENT_CLAUDE_BIN:'/unavailable-claude-worker',POLYAGENT_GROK_BIN:'/unavailable-grok',POLYAGENT_OPENCODE_BIN:'/unavailable-opencode',POLYAGENT_KIMI_BIN:'/unavailable-kimi',POLYAGENT_MUSE_BIN:'/unavailable-muse',POLYAGENT_ENABLE_CURSOR:'0',POLYAGENT_JEV_SHADOW:'0',POLYAGENT_JEV_VERIFY:'0',POLYAGENT_JEV_FANOUT:'0',POLYAGENT_TIMEOUT_MS:'240000'}}} : {}};
  const configPath = join(workspace,'mcp.json');
  if (arm === 'slim') config.mcpServers.polyagent.args = [join(ROOT,'bench/quota-slim.mjs')];
  writeFileSync(configPath,JSON.stringify(config));
  const args = ['-p',task.prompt,'--output-format','stream-json','--verbose','--dangerously-skip-permissions',
    '--setting-sources','project','--strict-mcp-config','--mcp-config',configPath,'--model',HOST_MODEL,'--effort',HOST_EFFORT,'--session-id',randomUUID(),'--max-turns','16','--disable-slash-commands',
    '--append-system-prompt',context + (arm === 'coarse' ? '\n'+COARSE : arm === 'slim' ? '\n'+SLIM : '')];
  const started = Date.now();
  let run;
  run = await runHost(args,workspace,join(OUT,`${trial}.private.jsonl`));
  const summary = summarizeEvents(run.events);
  const checkScript = task.id === 'implement' ? ledgerCheckScript(workspace) : task.id === 'batch' ? batchCheckScript(workspace)
    : task.id === 'tiny' ? tinyCheckScript(workspace) : task.id === 'medium' ? mediumCheckScript(workspace) : null;
  const check = checkScript ? spawnSync(process.execPath,['--input-type=module','-e',checkScript],{encoding:'utf8'}) : null;
  const workers = workerUsage(summary.handles);
  const workerAnswerMatches = summary.workerAnswers.map(answer=>answerMatches(answer,task.expected));
  const bridgeLog = jsonLines(log).map(entry => ({tool:entry.tool,engine:entry.engine,model:entry.model,outcome:entry.outcome,durationMs:entry.durationMs,outChars:entry.outChars}));
  const row = {task:task.id,project:task.project,rep,arm,startedUtc:new Date(started).toISOString(),durationMs:Date.now()-started,
    exitCode:run.code,timeout:run.timedOut,isError:summary.isError,accepted:trialAccepted({answerCorrect:answerMatches(summary.answer,task.expected) && (!check || check.status === 0),exitCode:run.code,isError:summary.isError,timeout:run.timedOut,bridgeLog,requiresDelegation:arm==='coarse'||arm==='slim',workerCount:workerAnswerMatches.filter(Boolean).length}),
    costUsd:summary.costUsd,hostTokens:summary.tokens,hostTokensFromStream:summary.streamTokens,hostTokenSource:summary.tokenSource,hostModelUsage:summary.modelUsage,
    toolNames:summary.tools.map(tool => tool.name),workers,workerHandlesCount:summary.handles.length,workerAnswerMatches,
    bridgeLog,
    contextSha256:createHash('sha256').update(context).digest('hex'),contextChars:context.length,
    stopReason:run.timedOut ? 'timeout' : summary.isError ? 'host_error' : null};
  appendFileSync(join(OUT,'quota-results.jsonl'),JSON.stringify(row)+'\n');
  console.log(JSON.stringify({trial,accepted:row.accepted,costUsd:row.costUsd,durationMs:row.durationMs,tools:row.toolNames,workers:workers.length}));
  if (summary.isError || run.code !== 0 || run.timedOut || row.bridgeLog.some(entry => ['quota','failure','timeout'].includes(entry.outcome))) {
    throw new Error(`trial ${trial} failed infrastructure/budget checks; stopping for inspection`);
  }
}

mkdirSync(OUT,{recursive:true});
writeFileSync(join(OUT,'plan.json'),JSON.stringify({hostModel:HOST_MODEL,hostEffort:HOST_EFFORT,repetitions:REPS,arms:ARM_SET,tasks:TASK_SET,minimumUsefulReductionPct:15,qualityTolerance:0,comparisons:COMPARISONS,quotaClaimAllowed:false,notes:'Pilot; API equivalent and tokens only. Global instructions baseline, not full plugin stack. Rotated order; no shared task directory. Codex workers only; no paid fallback.'},null,2));
const mode = process.argv[2] ?? 'run';
if (mode === 'smoke' || mode === 'smoke-bridge') {
  await attempt(mode === 'smoke' ? 'lean' : 'coarse',TASKS[0],99);
} else if (mode === 'summarize') {
  const rows = jsonLines(join(OUT,'quota-results.jsonl')).filter(row => row.rep !== 99);
  console.log(JSON.stringify({rows:rows.length,comparisons:COMPARISONS.map(([before,after]) => ({before,after,...pairedSummary(rows,before,after)}))},null,2));
} else {
  const prior = jsonLines(join(OUT,'quota-results.jsonl'));
  for (let rep=0;rep<REPS;rep++) for (let index=0;index<TASK_SET.length;index++) {
    for (let offset=0;offset<ARM_SET.length;offset++) {
      const arm = ARM_SET[(offset+index+rep)%ARM_SET.length];
      if (prior.some(row => row.rep===rep && row.task===TASK_SET[index].id && row.arm===arm)) continue;
      await attempt(arm,TASK_SET[index],rep);
    }
  }
}
