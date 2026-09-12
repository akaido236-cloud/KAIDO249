import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionManager } from '../src/security/permissions.js';
import { RiskEngine, maxRisk } from '../src/security/risk.js';
import { Permission, RiskLevel, WRITE_CONFIRM_POLICY_DUMMY } from './helpers.js';

test('child agents do not inherit the master permission set', () => {
  const pm = new PermissionManager();
  pm.setPermissions('master', [Permission.READ_GITHUB, Permission.WRITE_GITHUB, Permission.SEND_EMAIL]);
  pm.setPermissions('child', [Permission.READ_GITHUB]);

  assert.equal(pm.check('child', [Permission.READ_GITHUB]).granted, true);
  assert.equal(pm.check('child', [Permission.WRITE_GITHUB]).granted, false);
  assert.deepEqual(pm.check('child', [Permission.WRITE_GITHUB]).missing, [Permission.WRITE_GITHUB]);
  assert.equal(pm.check('master', [Permission.SEND_EMAIL]).granted, true);
});

test('permission grant and revoke are granular', () => {
  const pm = new PermissionManager();
  pm.setPermissions('a', []);
  assert.equal(pm.has('a', Permission.CAMERA), false);
  pm.grant('a', Permission.CAMERA);
  assert.equal(pm.has('a', Permission.CAMERA), true);
  pm.revoke('a', Permission.CAMERA);
  assert.equal(pm.has('a', Permission.CAMERA), false);
});

test('risk engine escalates side effects and forbids per policy', () => {
  const engine = new RiskEngine();
  assert.equal(engine.assess(RiskLevel.LOW, { sideEffect: false }), RiskLevel.LOW);
  assert.equal(engine.assess(RiskLevel.LOW, { sideEffect: true }), RiskLevel.MEDIUM);
  assert.equal(engine.assess(RiskLevel.LOW, { sideEffect: true, crossBoundary: true }), RiskLevel.HIGH);
  assert.equal(engine.assess(RiskLevel.MEDIUM, { sideEffect: true, financial: true }), RiskLevel.CRITICAL);

  const a = engine.evaluate(RiskLevel.HIGH, WRITE_CONFIRM_POLICY_DUMMY);
  assert.equal(a.requiresConfirmation, true);

  const forbidden = engine.evaluate(RiskLevel.HIGH, {
    requireConfirmationFor: [],
    forbiddenLevels: [RiskLevel.HIGH],
    allowAutomationOverride: false,
  });
  assert.equal(forbidden.forbidden, true);
});

test('maxRisk picks the higher level', () => {
  assert.equal(maxRisk(RiskLevel.MEDIUM, RiskLevel.CRITICAL), RiskLevel.CRITICAL);
  assert.equal(maxRisk(RiskLevel.HIGH, RiskLevel.LOW), RiskLevel.HIGH);
});

test('an automation cannot pre-authorise a forbidden action', () => {
  const engine = new RiskEngine();
  const assessment = engine.evaluate(RiskLevel.CRITICAL, {
    requireConfirmationFor: [RiskLevel.CRITICAL],
    forbiddenLevels: [RiskLevel.CRITICAL],
    allowAutomationOverride: true,
  }, true);
  assert.equal(assessment.forbidden, true);
  assert.equal(assessment.requiresConfirmation, false);
});
