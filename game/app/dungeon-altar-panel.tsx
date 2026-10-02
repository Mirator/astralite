'use client';

import { ARM_ORDER, ARM_PRICES, rankOf, UPGRADES, type BoughtArm, type Meta } from './dungeon-meta';
import { STARTING_WEAPON, weaponById } from './dungeon-weapon';

// The Tide Altar (plan 019, D10): where pearls are spent. It was the title menu's page; since plan 020 it is the shop overlay of the hall, opened with the swap key
// at the altar (the `buy` that answers it lives in the game). Two lists - the arms to
// unlock and the upgrades to buy the next rank of - and nothing else. It does not choose an arm: that is
// done on the racks of the hall. Every row is a real button that stays in the tab order when it cannot be bought
// (`aria-disabled`, not `disabled`), so a keyboard player can land on it and read why; pressing it then
// says the same thing in the note under the lists, and the game's `buy` is what refuses.

export type AltarKind = 'arm' | 'upgrade';

const pearls = (count: number) => `${count} ${count === 1 ? 'pearl' : 'pearls'}`;
const cost = (price: number, held: number) => price > held ? `${pearls(price)} · ${price - held} short` : pearls(price);

export default function AltarPanel({ meta, buy, note }: { meta: Meta; buy: (kind: AltarKind, id: string, refusal: string) => void; note: string }) {
  return <div className="menu-details altar-panel">
    <p className="altar-purse"><b>{pearls(meta.pearls)}</b> held</p>
    <p className="altar-lore">Arms are chosen on the racks of this hall, not here. The {weaponById(STARTING_WEAPON).name} is always yours; anything bought here is only unlocked.</p>
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
