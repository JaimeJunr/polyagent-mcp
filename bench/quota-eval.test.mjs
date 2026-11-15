import { test } from 'vitest';
import assert from 'node:assert/strict';
import { summarizeEvents, answerMatches, pairedSummary, trialAccepted, slimDelegateArgs } from './quota-eval-core.mjs';

test('reconciles streaming snapshots and preserves separate cache categories', () => {
  const events = [2, 7].map(output => ({type:'assistant', message:{id:'m1',model:'fixture-model',usage:{input_tokens:3,output_tokens:output,cache_read_input_tokens:40,cache_creation_input_tokens:5},content:[]}}));
  const result = summarizeEvents(events);
  assert.equal(result.tokens.output_tokens, 7);
  assert.equal(result.tokens.cache_read_input_tokens, 40);
  assert.equal(result.tokens.cache_creation_input_tokens, 5);
});
test('API failure remains failure even with a plausible answer', () => {
  const result = summarizeEvents([{type:'result',is_error:true,result:'{"count":3}',total_cost_usd:0.1}]);
  assert.equal(result.isError, true);
  assert.equal(result.costUsd, 0.1);
});
test('checks the answer against the independently specified expected fields', () => {
  assert.equal(answerMatches('```json\n{"count":3}\n```',{count:3}), true);
  assert.equal(answerMatches('{"count":0}',{count:3}), false);
  assert.equal(answerMatches('done',{count:3}), false);
});
test('paired summary retains failures and refuses to fabricate missing cost', () => {
  const rows=[{task:'a',rep:0,arm:'lean',accepted:true,costUsd:1},{task:'a',rep:0,arm:'bridge',accepted:false,costUsd:null}];
  const result=pairedSummary(rows,'lean','bridge');
  assert.equal(result.pairs,1);
  assert.equal(result.completeCostPairs,0);
  assert.equal(result.afterAccepted,0);
  assert.equal(result.costChangePct,null);
});

test('rejects host recovery after a worker infrastructure failure', () => {
  assert.equal(trialAccepted({answerCorrect:true,exitCode:0,isError:false,timeout:false,bridgeLog:[{outcome:'failure'}],requiresDelegation:true,workerCount:0}),false);
});

test('accepts verified successful delegation and rejects absent delegation in coarse arm', () => {
  const run={answerCorrect:true,exitCode:0,isError:false,timeout:false,bridgeLog:[{outcome:'success'}],requiresDelegation:true,workerCount:1};
  assert.equal(trialAccepted(run),true);
  assert.equal(trialAccepted({...run,workerCount:0}),false);
});

test('slim experiment retains the fixed Codex worker and complete prompt', () => {
  assert.deepEqual(slimDelegateArgs('Implement the entire task.','/fixture'),{prompt:'Implement the entire task.',cwd:'/fixture',level:'low',engine:'codex',model:'gpt-6-luna',effort:'medium'});
});

test('slim experiment refuses an empty task before dispatching', () => {
  assert.throws(()=>slimDelegateArgs('  ','/fixture'),/expected non-empty/);
});

test('uses final CLI model totals when partial output snapshots undercount tool arguments', () => {
  const result=summarizeEvents([{type:'assistant',message:{id:'m1',usage:{input_tokens:10,output_tokens:160,cache_creation_input_tokens:3697,cache_read_input_tokens:103853},content:[]}},
    {type:'result',is_error:false,total_cost_usd:0.0356833,modelUsage:{'claude-sonnet-5-5':{inputTokens:10,outputTokens:1049,cacheCreationInputTokens:3697,cacheReadInputTokens:103853}}}]);
  assert.equal(result.tokens.output_tokens,1049);
  assert.equal(result.streamTokens.output_tokens,160);
  assert.equal(result.tokenSource,'result.modelUsage');
});

test('keeps worker answers so a blocked worker cannot be hidden by host recovery', () => {
  const result=summarizeEvents([{type:'user',message:{content:[{type:'tool_result',tool_use_id:'t1',content:[{type:'text',text:'{"done":false}\n---\nsession_id: codex:fixture-session-id'}]}]}}]);
  assert.equal(result.workerAnswers.length,1);
  assert.equal(answerMatches(result.workerAnswers[0],{done:true}),false);
});
