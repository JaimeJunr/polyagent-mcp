const TOKEN_FIELDS = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];

/** @param {Record<string, unknown>[]} events */
export function summarizeEvents(events) {
  const messages = new Map();
  const tools = [];
  const handles = new Set();
  const workerAnswers = [];
  let result = null;
  for (const event of events) {
    if (event.type === 'result') result = event;
    const message = event.message;
    if (!message || typeof message !== 'object') continue;
    if (event.type === 'assistant' && message.id && message.usage) {
      const usage = messages.get(message.id) ?? {};
      for (const field of TOKEN_FIELDS) usage[field] = Math.max(usage[field] ?? 0, message.usage[field] ?? 0);
      messages.set(message.id, usage);
    }
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block.type === 'tool_use' && !tools.some(tool => tool.id === block.id)) tools.push({id:block.id,name:block.name});
      if (block.type === 'tool_result') {
        const matches=[...JSON.stringify(block.content).matchAll(/session_id[^a-zA-Z0-9]{1,12}(codex|claude|grok|opencode|kimi|muse):([a-zA-Z0-9_-]{8,})/g)];
        for (const match of matches) handles.add(`${match[1]}:${match[2]}`);
        if (matches.length) workerAnswers.push(Array.isArray(block.content) ? block.content.filter(item=>item.type==='text').map(item=>item.text).join('\n') : String(block.content));
      }
    }
  }
  const streamTokens = Object.fromEntries(TOKEN_FIELDS.map(field => [field, [...messages.values()].reduce((sum, usage) => sum + usage[field], 0)]));
  const totals = finalTokenTotals(result?.modelUsage);
  return {tokens:totals ?? streamTokens,streamTokens,tokenSource:totals ? 'result.modelUsage' : 'assistant.usage',tools,handles:[...handles],workerAnswers,isError:result?.is_error ?? true,costUsd:result?.total_cost_usd ?? null,
    answer:result?.result ?? '',modelUsage:result?.modelUsage ?? {},sessionId:result?.session_id ?? null};
}

/** @param {Record<string, Record<string, number>> | undefined} modelUsage */
export function finalTokenTotals(modelUsage) {
  const models=Object.values(modelUsage ?? {});
  const fields={input_tokens:'inputTokens',output_tokens:'outputTokens',cache_creation_input_tokens:'cacheCreationInputTokens',cache_read_input_tokens:'cacheReadInputTokens'};
  if (!models.length || models.some(model=>Object.values(fields).some(field=>typeof model[field] !== 'number'))) return null;
  return Object.fromEntries(Object.entries(fields).map(([key,field])=>[key,models.reduce((sum,model)=>sum+model[field],0)]));
}

/** @param {string} answer @param {Record<string, unknown>} expected */
export function answerMatches(answer, expected) {
  try {
    const first = answer.indexOf('{');
    const last = answer.lastIndexOf('}');
    const parsed = JSON.parse(answer.slice(first, last + 1));
    return Object.entries(expected).every(([key,value]) => JSON.stringify(parsed[key]) === JSON.stringify(value));
  } catch { return false; }
}

/** @param {Record<string, unknown>[]} rows @param {string} before @param {string} after */
export function pairedSummary(rows, before, after) {
  const pairs = rows.filter(row => row.arm === before).map(row => [row,rows.find(other => other.arm === after && other.task === row.task && other.rep === row.rep)]).filter(pair => pair[1]);
  const complete = pairs.filter(([left,right]) => left.costUsd !== null && right.costUsd !== null);
  const beforeCost = complete.reduce((sum,[left]) => sum + left.costUsd,0);
  const afterCost = complete.reduce((sum,[,right]) => sum + right.costUsd,0);
  return {pairs:pairs.length,completeCostPairs:complete.length,beforeAccepted:pairs.filter(([left]) => left.accepted).length,
    afterAccepted:pairs.filter(([,right]) => right.accepted).length,beforeCost,afterCost,
    costChangePct:beforeCost ? (afterCost / beforeCost - 1) * 100 : null};
}

/** @param {{answerCorrect:boolean,exitCode:number,isError:boolean,timeout:boolean,bridgeLog:{outcome?:string}[],requiresDelegation:boolean,workerCount:number}} run */
export function trialAccepted(run) {
  return run.answerCorrect && run.exitCode === 0 && !run.isError && !run.timeout
    && !run.bridgeLog.some(entry => ['quota','failure','timeout'].includes(entry.outcome))
    && (!run.requiresDelegation || run.workerCount > 0);
}

/** @param {string} prompt @param {string} cwd */
export function slimDelegateArgs(prompt,cwd) {
  if (!prompt.trim()) throw new Error(`invalid prompt: received ${JSON.stringify(prompt)}, expected non-empty string`);
  return {prompt,cwd,level:'low',engine:'codex',model:'gpt-6-luna',effort:'medium'};
}
