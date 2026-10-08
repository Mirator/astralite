'use client';

import { useEffect, useRef, useState } from 'react';
import { armFacts, ARM_ORDER, ARM_PRICES, rankOf, UPGRADES, type BoughtArm, type Meta } from './dungeon-meta';
import { STARTING_WEAPON, weaponById, type WeaponId } from './dungeon-weapon';

// The Tide Altar (plan 019, D10): where pearls are spent. It was the title menu's page; since plan 020 it is the shop overlay of the hall, opened with the swap key
// at the altar (the `buy` that answers it lives in the game). Two lists - the arms to
// unlock and the upgrades to buy the next rank of - and nothing else. It does not choose an arm: that is
// done on the racks of the hall. Every row is a real button that stays in the tab order when it cannot be bought
// (`aria-disabled`, not `disabled`), so a keyboard player can land on it and read why; pressing it then
// says the same thing in the note under the lists, and the game's `buy` is what refuses.
// Plan 025 (D8): the hall itself is the shop now (the racks and the shrines, held to buy); this list survives as a page of the hall's pause card, for touch and
// for a keyboard player. `HallPurse` and `RackCard` below are the hall's own: the pearl counter and the card at a rack or a shrine.

export type AltarKind = 'arm' | 'upgrade';

const pearls = (count: number) => `${count} ${count === 1 ? 'pearl' : 'pearls'}`;
const cost = (price: number, held: number) => price > held ? `${pearls(price)} · ${price - held} short` : pearls(price);

export default function AltarPanel({ meta, buy, note }: { meta: Meta; buy: (kind: AltarKind, id: string, refusal: string) => void; note: string }) {
  return <div className="menu-details altar-panel">
    <p className="altar-purse"><b>{pearls(meta.pearls)}</b> held</p>
    <p className="altar-lore">Arms are chosen on the racks of this hall, not here; any arm can be tried there, and held for a moment to buy. The {weaponById(STARTING_WEAPON).name} is always yours; anything bought here is only unlocked.</p>
    <h3>Arms</h3>
    <div className="altar-list">
      {ARM_ORDER.filter((id): id is BoughtArm => id !== STARTING_WEAPON).map(id => {
        const weapon = weaponById(id), owned = meta.arms.includes(id), price = ARM_PRICES[id];
        return <button key={id} className={`altar-item${owned ? ' owned' : ''}`} data-item={id} aria-disabled={owned || meta.pearls < price} onClick={() => buy('arm', id, owned ? `${weapon.name} is already unlocked.` : `${weapon.name} costs ${pearls(price)}; you hold ${meta.pearls}.`)}>
          <strong>{weapon.name}</strong><span>{weapon.special ? `Special · ${weapon.special.name}` : 'No special'}</span><em>{owned ? 'Unlocked' : cost(price, meta.pearls)}</em>
        </button>;
      })}
    </div>
    <h3>Upgrades</h3>
    <div className="altar-list">
      {UPGRADES.map(upgrade => {
        const held = rankOf(meta.upgrades, upgrade.id), maxed = held >= upgrade.ranks, price = upgrade.price(held);
        return <button key={upgrade.id} className={`altar-item${maxed ? ' owned' : ''}`} data-item={upgrade.id} aria-disabled={maxed || meta.pearls < price} onClick={() => buy('upgrade', upgrade.id, maxed ? `${upgrade.name} is fully bought.` : `${upgrade.name} costs ${pearls(price)}; you hold ${meta.pearls}.`)}>
          <strong>{upgrade.name}{upgrade.ranks > 1 ? ` · ${held} of ${upgrade.ranks}` : ''}</strong><span>{upgrade.detail}</span><em>{maxed ? (upgrade.ranks > 1 ? 'Fully bought' : 'Bought') : cost(price, meta.pearls)}</em>
        </button>;
      })}
    </div>
    <output className="altar-note" aria-live="polite">{note}</output>
  </div>;
}

/** What the card at a rack or a shrine shows: the arm or upgrade, and the price of what is next (null when there is nothing next). */
export type ShopCard = { kind: 'arm'; id: WeaponId; owned: boolean; price: number | null; short: number } | { kind: 'upgrade'; id: string; held: number; ranks: number; price: number | null; short: number };

/** Plan 025 (D8): the card at a rack or a shrine. Not persistent: it exists only while the knight stands in the ring, like the prompt under it. */
export function RackCard({ card }: { card: ShopCard }) {
  if (card.kind === 'upgrade') {
    const upgrade = UPGRADES.find(each => each.id === card.id)!;
    return <aside className="rack-card" aria-label={upgrade.name}><strong>{upgrade.name}</strong><span>{upgrade.detail}</span>
      <ul className="rack-notches" aria-label={`${card.held} of ${card.ranks} ${card.ranks === 1 ? 'rank' : 'ranks'} held`}>{Array.from({ length: card.ranks }, (_, i) => <li key={i} className={i < card.held ? 'held' : ''} />)}</ul>
      <em>{card.price === null ? 'Fully bought' : `${pearls(card.price)}${card.short > 0 ? ` · ${card.short} short` : ''}`}</em></aside>;
  }
  const facts = armFacts(card.id);
  return <aside className={`rack-card${card.owned ? '' : ' locked'}`} aria-label={facts.name}><strong>{facts.name}</strong><span>{facts.detail}</span>
    <dl className="rack-facts"><div><dt>Damage</dt><dd>{facts.damage}</dd></div><div><dt>{facts.ranged ? 'Range' : 'Reach'}</dt><dd>{facts.reach}</dd></div><div><dt>Swings/s</dt><dd>{facts.speed}</dd></div></dl>
    <span className="rack-special">{facts.special ? `Special · ${facts.special.name}` : 'No special'}</span>
    <em>{card.owned ? 'Owned' : card.price === null ? '' : `Locked · ${pearls(card.price)}${card.short > 0 ? ` · ${card.short} short` : ''}`}</em></aside>;
}

/**
 * Plan 025 (D8): the pearl counter, in the hall only (the minimal HUD: it is gone once the descent starts). It ticks to a new balance a pearl at a time
 * rather than jumping, and pulses when the hall was entered with something newly in reach. The balance it settles on is the save's (`pearls`).
 */
export function HallPurse({ pearls: held, pulse }: { pearls: number; pulse: boolean }) {
  const [shown, setShown] = useState(held), from = useRef(held);
  useEffect(() => {
    const start = from.current, gap = held - start;
    if (gap === 0) return;
    const began = performance.now(), length = Math.min(600, 40 * Math.abs(gap));
    let frame = 0;
    const tick = () => { const k = Math.min(1, (performance.now() - began) / length), now = Math.round(start + gap * k); from.current = now; setShown(now); if (k < 1) frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); from.current = held; setShown(held); };
  }, [held]);
  return <output className={`hall-purse${pulse ? ' pulse' : ''}${shown !== held ? ' ticking' : ''}`} aria-label={`${held} ${held === 1 ? 'pearl' : 'pearls'} held`} data-pearls={held}><i aria-hidden="true" /><b>{shown}</b></output>;
}
