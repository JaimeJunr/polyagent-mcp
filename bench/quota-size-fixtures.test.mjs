import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createSizeFixture, tinyCheckScript, mediumCheckScript } from './quota-size-fixtures.mjs';

function runCheck(script) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  return result.status;
}

test('tiny: fixture com o bug original falha o check, correção passa', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'quota-tiny-'));
  createSizeFixture(workspace, 'age-gate');
  assert.notEqual(runCheck(tinyCheckScript(workspace)), 0);
  writeFileSync(join(workspace, 'src/age.mjs'), 'export function isAdult(age) { return age >= 18; }\n');
  assert.equal(runCheck(tinyCheckScript(workspace)), 0);
});

test('medium: fixture com "not implemented" falha o check, implementação correta passa', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'quota-medium-'));
  createSizeFixture(workspace, 'transfer');
  assert.notEqual(runCheck(mediumCheckScript(workspace)), 0);
  writeFileSync(join(workspace, 'src/transfer.mjs'), `export function computeFee(amount, feeRate) { return Math.max(1, Math.round(amount * feeRate)); }
export function applyTransfer(ledger, from, to, amount, feeRate) {
  if (!Number.isInteger(amount) || amount <= 0) throw new RangeError(\`invalid amount: received \${amount}, expected a positive integer\`);
  if (!(from in ledger.balances) || !(to in ledger.balances) || from === to) throw new RangeError(\`invalid accounts: received from=\${from}, to=\${to}\`);
  const fee = computeFee(amount, feeRate);
  if (ledger.balances[from] < amount + fee) throw new RangeError(\`insufficient balance: received \${ledger.balances[from]}, expected >= \${amount + fee}\`);
  ledger.balances[from] -= amount + fee;
  ledger.balances[to] += amount;
  ledger.feesCollected += fee;
  return { fee, newFromBalance: ledger.balances[from], newToBalance: ledger.balances[to] };
}
`);
  assert.equal(runCheck(mediumCheckScript(workspace)), 0);
});
