// The boon draft's guard against a pick nobody meant (plan 026 D2).
//
// The draft opens on the frame a kill grants a rank, under a cursor that was striking a moment ago. When one click took a card, a
// knight spamming the strike button took whichever card opened under the pointer. Now a card is never taken by clicking it: a click
// *selects* it, and only TAKE (a separate button under the cards, so a click on the same spot cannot reach it) takes what is selected.
// Nothing counts for `DRAFT_ARM` after the draft opens, so a click already on its way lands on nothing.
//
// Pure: no React, no DOM. Times are seconds on any one clock the caller keeps.

/** Seconds after a draft opens during which no press on it counts. */
export const DRAFT_ARM = 0.4;

/** One open draft: when it opened, and the card selected (null: none yet). */
export type Draft = { openedAt: number; selected: string | null };

export const openDraft = (now: number): Draft => ({ openedAt: now, selected: null });

/** Whether the draft has been open long enough for a press to count. */
export const draftArmed = (draft: Draft, now: number) => now - draft.openedAt >= DRAFT_ARM;

/** A press on the card `id`: selects it once the draft is armed, and before that changes nothing. Never takes it. */
export const pressCard = (draft: Draft, id: string, now: number): Draft => draftArmed(draft, now) ? { ...draft, selected: id } : draft;

/** A press on TAKE: the card to take, or null when the draft is not armed yet or nothing is selected. */
export const pressTake = (draft: Draft, now: number): string | null => draftArmed(draft, now) ? draft.selected : null;
