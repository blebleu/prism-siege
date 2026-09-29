// Ship upgrades. Collecting shards earns XP; each level-up offers three upgrades to choose from, and the chosen
// ones stack in ranks for the rest of the run (deaths included). shipStats() turns the ranks into the numbers
// the simulation uses.

// kind groups the cards by colour: weapon, ship (movement and pickups) or defense.
export const UPGRADES = {
  rapid:     { name: 'Rapid Fire',      kind: 'weapon',  max: 5, text: () => 'Fire 18% faster' },
  multishot: { name: 'Multishot',       kind: 'weapon',  max: 3, text: () => '+1 bullet in every volley' },
  heavy:     { name: 'Heavy Rounds',    kind: 'weapon',  max: 4, text: () => '+50% bullet damage' },
  pierce:    { name: 'Piercing Rounds', kind: 'weapon',  max: 3, text: () => 'Bullets pass through one more enemy' },
  ricochet:  { name: 'Ricochet',        kind: 'weapon',  max: 2, text: () => 'Bullets bounce off the walls once more' },
  homing:    { name: 'Seeker Rounds',   kind: 'weapon',  max: 2, text: rank => rank === 1 ? 'Bullets curve toward nearby enemies' : 'Bullets curve harder' },
  tailgun:   { name: 'Tail Guns',       kind: 'weapon',  max: 2, text: rank => rank === 1 ? 'Also fire a stream backward' : 'Also fire to both sides' },
  orbitals:  { name: 'Orbitals',        kind: 'weapon',  max: 3, text: rank => rank === 1 ? 'A prism circles your ship, shredding what it touches' : '+1 circling prism' },
  thrusters: { name: 'Thrusters',       kind: 'ship',    max: 4, text: () => 'Move 8% faster' },
  phase:     { name: 'Phase Drive',     kind: 'ship',    max: 3, text: () => 'Dash recharges 20% faster' },
  ram:       { name: 'Ram Dash',        kind: 'ship',    max: 1, text: () => 'Dashing through enemies hits them hard' },
  magnet:    { name: 'Magnet',          kind: 'ship',    max: 3, text: () => 'Pull in shards from 50% farther away' },
  shield:    { name: 'Deflector',       kind: 'defense', max: 3, text: rank => rank === 1 ? 'A shield absorbs one hit, then recharges in 30 s' : 'Shield recharges 6 s sooner' },
  // Offered only when there aren't enough other upgrades left to fill the three cards.
  salvage:   { name: 'Salvage',         kind: 'defense', max: Infinity, filler: true, text: () => '+1 bomb' }
};

export const CHOICES = 3;

// XP needed to go from `level` to the next one: the first few come quickly, later ones take longer.
export const xpToNext = level => Math.round(6 + 3 * (level - 1) + 0.6 * (level - 1) ** 2);

export function shipStats(ranks = {}) {
  const r = id => ranks[id] ?? 0;
  return {
    // Fewer, harder-hitting shots: 6 a second at 1.5 damage (Heavy Rounds adds half the base per rank).
    fireRate: 6 * (1 + 0.18 * r('rapid')),
    streams: 2 + r('multishot'),
    damage: 1.5 * (1 + 0.5 * r('heavy')),
    pierce: r('pierce'),
    bounces: r('ricochet'),
    homing: r('homing'),
    tailgun: r('tailgun'),
    orbitals: r('orbitals'),
    speed: 1 + 0.08 * r('thrusters'),
    dashCooldown: 0.85 * (1 - 0.2 * r('phase')),
    ram: r('ram') > 0,
    magnet: 170 * (1 + 0.5 * r('magnet')),
    shieldTime: r('shield') ? 30 - 6 * (r('shield') - 1) : 0
  };
}

// Three different upgrades that aren't maxed out yet, topped up with Salvage if too few are left.
export function rollChoices(ranks, rand) {
  const pool = Object.keys(UPGRADES).filter(id => !UPGRADES[id].filler && (ranks[id] ?? 0) < UPGRADES[id].max);
  const picked = [];
  while (picked.length < CHOICES && pool.length) picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  if (picked.length < CHOICES) picked.push('salvage');
  return picked;
}

// Roman numerals for ranks on the cards and in the build list.
export const rankLabel = rank => ['', 'I', 'II', 'III', 'IV', 'V', 'VI'][rank] ?? String(rank);
