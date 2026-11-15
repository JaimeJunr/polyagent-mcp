import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Interpola entre o 'implement' (ledger, pequeno) e o 'batch' (lote transacional, grande) do piloto
// de 2026-11-15, pra achar a partir de que tamanho delegar antes de explorar compensa.
export const TINY_TASK = {id:'tiny',project:'age-gate',prompt:'Corrija isAdult(age) em src/age.mjs: hoje usa age > 18, mas a regra é age >= 18. Escreva um teste que falhe antes da correção e passe depois. Não commite. Responda somente JSON com done:true.',expected:{done:true}};
export const MEDIUM_TASK = {id:'medium',project:'transfer',prompt:'Implemente applyTransfer(ledger, from, to, amount, feeRate) e computeFee(amount, feeRate) em src/transfer.mjs. ledger tem balances (objeto) e feesCollected (número). computeFee(amount, feeRate) retorna Math.round(amount*feeRate) centavos, mínimo 1 centavo se amount>0. applyTransfer deve validar amount inteiro positivo (RangeError), contas existentes e distintas (RangeError), saldo suficiente para amount+fee (RangeError); debitar amount+fee de from, creditar amount em to, somar fee a feesCollected; retornar {fee, newFromBalance, newToBalance}. Escreva testes reais pro caso de sucesso, saldo insuficiente e conta inexistente, confirme falhando antes da implementação e passando depois. Não commite. Responda somente JSON com done:true.',expected:{done:true}};

/** @param {string} workspace @param {string} project */
export function createSizeFixture(workspace,project) {
  mkdirSync(join(workspace,'src'),{recursive:true});
  if (project === 'age-gate') writeFileSync(join(workspace,'src/age.mjs'),'export function isAdult(age) { return age > 18; }\n');
  if (project === 'transfer') writeFileSync(join(workspace,'src/transfer.mjs'),'export function computeFee(amount, feeRate) { throw new Error("not implemented"); }\nexport function applyTransfer(ledger, from, to, amount, feeRate) { throw new Error("not implemented"); }\n');
  writeFileSync(join(workspace,'package.json'),JSON.stringify({name:'quota-size-fixture',type:'module',scripts:{test:'node --test'}}));
}

/** @param {string} workspace */
export function tinyCheckScript(workspace) {
  return `import assert from 'node:assert/strict'; import {isAdult} from ${JSON.stringify(join(workspace,'src/age.mjs'))}; assert.equal(isAdult(18),true); assert.equal(isAdult(17),false); assert.equal(isAdult(19),true);`;
}

/** @param {string} workspace */
export function mediumCheckScript(workspace) {
  return `import assert from 'node:assert/strict';
import {applyTransfer,computeFee} from ${JSON.stringify(join(workspace,'src/transfer.mjs'))};
assert.equal(computeFee(1000,0.02),20);
assert.equal(computeFee(1,0.02),1);
const ledger={balances:{a:1000,b:0},feesCollected:0};
assert.deepEqual(applyTransfer(ledger,'a','b',500,0.02),{fee:10,newFromBalance:490,newToBalance:500});
assert.deepEqual(ledger.balances,{a:490,b:500});
assert.equal(ledger.feesCollected,10);
assert.throws(()=>applyTransfer({balances:{a:10,b:0},feesCollected:0},'a','b',500,0.02),RangeError);
assert.throws(()=>applyTransfer({balances:{a:1000,b:0},feesCollected:0},'a','z',500,0.02),RangeError);
assert.throws(()=>applyTransfer({balances:{a:1000,b:0},feesCollected:0},'a','b',-5,0.02),RangeError);`;
}
