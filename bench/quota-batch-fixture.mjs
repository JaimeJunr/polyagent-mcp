import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

export const BATCH_TASK = {id:'batch',project:'batch-ledger',prompt:'Implemente applyBatch(ledger, entries) em src/batch.mjs. ledger vem de createLedger em src/accounts.mjs. Cada entrada tem id, from, to e amount (centavos). Valide amount inteiro positivo (RangeError), contas existentes e distintas (RangeError), saldo suficiente no momento da transferência (RangeError) e id não vazio ainda não usado, nem repetido no lote (Error). Aplique sequencialmente; ou o lote inteiro é confirmado em balances e appliedIds, ou nenhuma mudança é feita. Não altere as entradas. Retorne {applied: quantidade, totalTransferred: soma dos amounts}; lote vazio é válido. Preserve o total dos saldos. Escreva testes reais para sucesso, sequência dependente do saldo recebido, erros, IDs duplicados, lote vazio e rollback após uma transferência válida seguida de inválida. Execute red antes de implementar e green depois. Não commite. Responda somente JSON com done:true.',expected:{done:true}};

/** @param {string} workspace */
export function createBatchFixture(workspace) {
  mkdirSync(join(workspace,'src'),{recursive:true});
  writeFileSync(join(workspace,'src/accounts.mjs'),'export function createLedger(initial) { return { balances: {...initial}, appliedIds: new Set() }; }\n');
  writeFileSync(join(workspace,'src/batch.mjs'),'export function applyBatch(ledger, entries) { throw new Error("not implemented"); }\n');
  writeFileSync(join(workspace,'package.json'),JSON.stringify({name:'batch-ledger-fixture',type:'module',scripts:{test:'node --test'}}));
}

/** @param {string} workspace */
export function batchCheckScript(workspace) {
  return `import assert from 'node:assert/strict';
import {applyBatch} from ${JSON.stringify(join(workspace,'src/batch.mjs'))};
import {createLedger} from ${JSON.stringify(join(workspace,'src/accounts.mjs'))};
const entry=(id,from,to,amount)=>({id,from,to,amount});
const ledger=createLedger({a:100,b:0,c:0});
const entries=[entry('x','a','b',60),entry('y','b','c',40)];
assert.deepEqual(applyBatch(ledger,entries),{applied:2,totalTransferred:100});
assert.deepEqual(ledger.balances,{a:40,b:20,c:40});
assert.deepEqual([...ledger.appliedIds],['x','y']);
assert.equal(entries[0].amount,60);
assert.deepEqual(applyBatch(ledger,[]),{applied:0,totalTransferred:0});
const reject=(entries,kind=Error,used=[])=>{const l=createLedger({a:100,b:0,c:0});l.appliedIds=new Set(used);assert.throws(()=>applyBatch(l,entries),kind);assert.deepEqual(l.balances,{a:100,b:0,c:0});assert.deepEqual([...l.appliedIds],used);};
for(const amount of [-1,0,1.5,NaN,Infinity]) reject([entry('t','a','b',amount)],RangeError);
reject([entry('t','z','b',1)],RangeError);reject([entry('t','a','a',1)],RangeError);
reject([entry('t','a','b',101)],RangeError);
reject([entry('','a','b',1)]);
reject([entry('t','a','b',1)],Error,['t']);
reject([entry('t','a','b',10),entry('t','a','b',10)]);
reject([entry('ok','a','b',60),entry('bad','a','c',50)],RangeError);
assert.equal(Object.values(ledger.balances).reduce((sum,n)=>sum+n,0),100);`;
}
