# Prism Siege

A neon twin-stick arena shooter with roguelike upgrades. Survive endless waves of geometric enemies; everything you
destroy drops gold shards that raise your score multiplier (dying resets it) and earn XP. Each level-up pauses the
fight to offer three ship upgrades, which stack for the rest of the run. Every eighth wave brings a boss, the Warden.

## Run it

Install Node.js 22 or newer, then run:

```text
npm start
```

Open `http://localhost:3010`. There is no package install or build step. Run `npm test` for the simulation, wave,
save and server checks.

On the live site the game is served at `treasurepast.com/prism-siege/`. The portal page that lists all games, and
the routing to each one, live in the separate `treasurepast-site` repo. Deploying the game itself is covered in
[deploy/README.md](deploy/README.md).

## Controls

| | Keyboard & mouse | Gamepad | Touch |
|---|---|---|---|
| Move | WASD | Left stick | Drag on the left half |
| Aim and fire | Mouse (auto-fire), or arrow keys | Right stick | Drag on the right half |
| Dash (invulnerable) | Space, Shift or right-click | A / RB | Dash button |
| Bomb | E or Q | B / LB | Bomb button |
| Pause | Esc or P | Start | Pause button |

## How it's built

Plain JavaScript modules drawing on a canvas. Nothing is downloaded at runtime: shapes are drawn in code and all
sound is synthesized with the Web Audio API.

| File | What it does |
|---|---|
| `src/sim.js` | The game rules, with no DOM: `step(world, input, dt)` advances a world and reports what happened in `world.events` |
| `src/enemies.js` | Each enemy type's numbers and behaviour |
| `src/upgrades.js` | The upgrades on offer at level-ups, the XP curve, and the ship stats each set of ranks gives |
| `src/director.js` | Builds waves from a growing point budget, spawns them in formations away from the player, and makes enemies tougher each wave |
| `src/bot.js` | An autopilot (with its own upgrade picks): plays the demo behind the title screen, and the tests use it to play whole games |
| `src/render.js`, `src/grid.js`, `src/fx.js` | Drawing: neon shapes with additive glow and bloom, the warping grid, sparks, shake and hit-stop |
| `src/input.js` | Keyboard, mouse, gamepad and touch sticks, turned into one input |
| `src/audio.js` | Synthesized sound effects and music |
| `src/main.js` | Screens, the frame loop, the HUD, settings and saved scores |

The simulation takes all its randomness from a seed, so a game replays exactly from its seed and inputs. That's
what lets the tests play long games in a fraction of a second, and it's the place to start when tuning
difficulty: run the autopilot over a few seeds and see which wave and level it reaches. Upgrades make the ship
much stronger over a run, so enemy toughness compounds by 10% a wave from wave 7 (`toughnessFor` in
`src/director.js`); that, the XP curve (`xpToNext`) and the upgrade numbers (`shipStats`) are the main dials.

On `localhost` only, `?wave=8` starts a game at that wave, and the browser console has `prism` (the live world,
plus `prism.advance(seconds)` and `prism.autopilot = true`).

## Saves

The best score, the top five runs and the settings are kept in the browser under keys starting
`tp:prism-siege:`, because every game on treasurepast.com shares one browser storage area. `src/save.js` is the
helper: versioned saves that never throw when storage is blocked or full.
