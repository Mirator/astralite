import assert from 'node:assert/strict';
import test from 'node:test';
import { DRAFT_ARM, draftArmed, openDraft, pressCard, pressTake } from '../app/dungeon-draft.ts';

// Plan 026 (D2): a boon is never taken by the click that happened to be in flight when the draft opened, nor by clicking a card at all.

test('no press counts until the draft has been open for DRAFT_ARM', () => {
  const draft = openDraft(10);
  assert.ok(DRAFT_ARM >= 0.25, `an arming delay of ${DRAFT_ARM} s is shorter than a strike-spamming click interval`);
  const early = pressCard(draft, 'whetstone', 10 + DRAFT_ARM / 2);
  assert.equal(early.selected, null, 'a card was selected by a press inside the arming delay');
  assert.equal(pressTake({ ...draft, selected: 'whetstone' }, 10 + DRAFT_ARM / 2), null, 'TAKE counted inside the arming delay');
  assert.equal(draftArmed(draft, 10 + DRAFT_ARM), true, 'the draft never arms');
});

test('a click on a card only selects it, however often it is repeated; TAKE takes the selected card', () => {
  let draft = openDraft(0);
  const at = DRAFT_ARM + 0.1;
  for (let i = 0; i < 10; i++) draft = pressCard(draft, 'whetstone', at + i * 0.05);
  assert.equal(draft.selected, 'whetstone', 'the card pressed is not the one selected');
  // A press on another card moves the selection; it never takes the first.
  draft = pressCard(draft, 'salt-ward', at + 1);
  assert.equal(draft.selected, 'salt-ward', 'a press on another card did not move the selection');
  assert.equal(pressTake(draft, at + 1.1), 'salt-ward', 'TAKE did not take the selected card');
});

test('TAKE with nothing selected takes nothing', () => {
  assert.equal(pressTake(openDraft(0), DRAFT_ARM + 1), null);
});
