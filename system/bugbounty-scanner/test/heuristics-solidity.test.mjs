import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findReentrancyRisk, findUncheckedCallReturn, findTxOriginAuth, findDelegatecallRisk, scanSoliditySource } from '../heuristics-solidity.mjs';

test('findReentrancyRisk acha chamada externa seguida de escrita de estado (padrão da The DAO)', () => {
  const src = `
    function withdraw(uint amount) public {
      require(balances[msg.sender] >= amount);
      (bool ok, ) = msg.sender.call{value: amount}("");
      require(ok);
      balances[msg.sender] -= amount;
    }
  `;
  const findings = findReentrancyRisk(src, 'x.sol');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'reentrancy_risk');
});

test('findReentrancyRisk NÃO sinaliza quando estado é atualizado ANTES da chamada externa (padrão correto)', () => {
  const src = `
    function withdraw(uint amount) public {
      require(balances[msg.sender] >= amount);
      balances[msg.sender] -= amount;
      (bool ok, ) = msg.sender.call{value: amount}("");
      require(ok);
    }
  `;
  assert.equal(findReentrancyRisk(src, 'x.sol').length, 0);
});

test('findUncheckedCallReturn acha .call sem capturar retorno', () => {
  const src = `target.call{value: amount}("");`;
  const findings = findUncheckedCallReturn(src, 'x.sol');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'unchecked_call_return');
});

test('findUncheckedCallReturn NÃO sinaliza quando o retorno é capturado em (bool ok, )', () => {
  const src = `(bool ok, ) = target.call{value: amount}("");`;
  assert.equal(findUncheckedCallReturn(src, 'x.sol').length, 0);
});

test('findTxOriginAuth acha require(tx.origin == ...)', () => {
  const src = `require(tx.origin == owner, "not owner");`;
  const findings = findTxOriginAuth(src, 'x.sol');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'tx_origin_auth_risk');
});

test('findTxOriginAuth NÃO sinaliza checagem via msg.sender', () => {
  const src = `require(msg.sender == owner, "not owner");`;
  assert.equal(findTxOriginAuth(src, 'x.sol').length, 0);
});

test('findDelegatecallRisk acha delegatecall em endereço não-constante', () => {
  const src = `
    address target = registry.getImplementation();
    target.delegatecall(msg.data);
  `;
  const findings = findDelegatecallRisk(src, 'x.sol');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'delegatecall_risk');
});

test('findDelegatecallRisk NÃO sinaliza delegatecall em endereço immutable', () => {
  const src = `
    address immutable target;
    target.delegatecall(msg.data);
  `;
  assert.equal(findDelegatecallRisk(src, 'x.sol').length, 0);
});

test('scanSoliditySource roda sem quebrar em contrato limpo', () => {
  const src = `
    contract Simple {
      function add(uint a, uint b) public pure returns (uint) {
        return a + b;
      }
    }
  `;
  assert.equal(scanSoliditySource(src, 'clean.sol').length, 0);
});
