'use client';

import { SLOTS, type Slot, type slotSummary } from './dungeon-save';

// The title's slot picker (plan 020, D3): ENTER THE KEEP opens it in place of the menu list, as a page of the same card. Three cards, one per
// save slot, each a real button that enters that slot and shows what it holds (pearls, the deepest floor, the runs logged and the arms owned),
// or "Empty". A slot with something in it has an Erase beside its card, and Erase takes two presses: the first arms it and the card says so, the
// second erases. Any other press in the picker disarms it (`disarm`, on the capture phase, so a press on another card's Erase disarms this one
// before arming that one). The game owns what a press does; this only draws the cards and says which one is armed.

type Summary = ReturnType<typeof slotSummary>;

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const describe = (slot: Summary) => slot.empty ? 'Empty' : `${plural(slot.pearls, 'pearl')} · ${slot.best > 0 ? `deepest floor ${slot.best}` : 'no floor reached'} · ${plural(slot.runs, 'run')} logged · ${plural(slot.arms, 'arm')}`;

export default function SlotPicker({ slots, last, erasing, note, choose, erase, disarm }: { slots: Summary[]; last: Slot; erasing: Slot | null; note: string; choose: (slot: Slot) => void; erase: (slot: Slot) => void; disarm: () => void }) {
  return <div className="menu-details slot-picker" onClickCapture={(e) => { if (erasing !== null && !(e.target as Element).closest(`[data-erase="${erasing}"]`)) disarm(); }}>
    <p className="slot-lore">Each slot keeps its own pearls, arms and run log. Settings are shared.</p>
    <div className="slot-list">
      {SLOTS.map(slot => {
        const summary = slots[slot - 1], armed = erasing === slot;
        // Not drawn before the picker has read the slots (it is only ever opened by `openView`, which does).
        if (!summary) return null;
        return <div key={slot} className={`slot-card${summary.empty ? ' empty' : ''}${armed ? ' armed' : ''}`} data-slot={slot}>
          <button className="slot-choose" data-slot={slot} onClick={() => choose(slot)}>
            <strong>Slot {slot}</strong>{last === slot && !summary.empty && <small>last played</small>}
            <span>{describe(summary)}</span>
          </button>
          {!summary.empty && <button className="slot-erase" data-erase={slot} aria-label={armed ? `Press again to erase slot ${slot}` : `Erase slot ${slot}`} onClick={() => erase(slot)}>{armed ? 'Press again to erase' : 'Erase'}</button>}
        </div>;
      })}
    </div>
    <output className="slot-note" aria-live="polite">{note}</output>
  </div>;
}
