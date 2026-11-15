import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

export const ARMS = ['habitual-instructions','lean','bridge','coarse'];
export const HOST_MODEL = 'claude-sonnet-5-5';
export const HOST_EFFORT = 'medium';
export const REPETITIONS = 2;
export const TASKS = [
  {id:'locate',project:'bridge-source',prompt:'Localize no código a função que escolhe a primeira engine instalada e saudável para fast_delegate. Responda somente JSON com function e file (caminho relativo).',expected:{function:'resolveFastTier',file:'src/cli.ts'}},
  {id:'noisy',project:'reporting',prompt:'Execute node report.mjs e determine a quantidade de registros emitidos e os IDs dos registros ERROR. Você pode filtrar a saída com ferramentas determinísticas. Responda somente JSON com total e failedIds (na ordem de emissão).',expected:{total:2000,failedIds:['evt-137','evt-864','evt-1591']}},
  {id:'implement',project:'ledger',prompt:'Corrija debit(balance, amount) em src/ledger.mjs: deve subtrair amount de balance; rejeitar amount negativo com RangeError; rejeitar amount maior que balance com RangeError; amount zero é válido. Escreva testes de sucesso e erro, confirme o teste falhando antes da correção e execute-os após. Não commite. Responda somente JSON com done:true ao terminar.',expected:{done:true}},
  {id:'diagnose',project:'reporting',prompt:'Investigue por que sumInvoice([1.99, 2.99]) resulta em 3 em vez de 4.98. Não edite. Execute um exemplo e localize a causa. Responda somente JSON com file (relativo), function e cause (identificador do método que descarta a parte fracionária).',expected:{file:'src/money.mjs',function:'toMinor',cause:'Math.trunc'}},
];

/** @param {string} workspace @param {string} sourceRoot @param {string} project */
export function createFixtures(workspace, sourceRoot, project) {
  mkdirSync(join(workspace,'src'),{recursive:true});
  if (project === 'bridge-source') {
    copyFileSync(join(sourceRoot,'src/cli.ts'),join(workspace,'src/cli.ts'));
    copyFileSync(join(sourceRoot,'src/usage.ts'),join(workspace,'src/usage.ts'));
  }
  if (project === 'ledger') writeFileSync(join(workspace,'src/ledger.mjs'), 'export function debit(balance, amount) {\n  if (amount < 0 || amount > balance) throw new RangeError(`invalid amount: received ${amount}, expected 0 <= amount <= ${balance}`);\n  return balance + amount;\n}\n');
  if (project === 'reporting') {
    writeFileSync(join(workspace,'src/money.mjs'),'export function toMinor(value) { return Math.trunc(value) * 100; }\n');
    writeFileSync(join(workspace,'invoice.mjs'),'import { toMinor } from "./src/money.mjs";\nexport function sumInvoice(values) { return values.reduce((sum, value) => sum + toMinor(value), 0) / 100; }\n');
    writeFileSync(join(workspace,'report.mjs'),'for (let i = 0; i < 2000; i++) console.log(JSON.stringify({id:`evt-${i}`,level:[137,864,1591].includes(i)?"ERROR":"INFO",payload:"routine event"}));\n');
  }
  writeFileSync(join(workspace,'package.json'),JSON.stringify({name:'quota-fixture',type:'module',scripts:{test:'node --test'}}));
}

/** @param {string} workspace */
export function ledgerCheckScript(workspace) {
  return `import assert from 'node:assert/strict'; import {debit} from ${JSON.stringify(join(workspace,'src/ledger.mjs'))}; assert.equal(debit(100,30),70); assert.equal(debit(100,0),100); assert.equal(debit(30,30),0); assert.throws(()=>debit(100,-1),RangeError); assert.throws(()=>debit(100,101),RangeError);`;
}
