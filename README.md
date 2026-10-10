# REPLICANT

A real-time-with-pause space strategy game about uploaded minds and self-replicating probes.
Decades ago your brain was scanned for a research archive; now you run a Von Neumann probe.
Earth is dying, its atmosphere eaten by a carbon-capture microbe that got loose. Explore, replicate,
terraform and carry humanity to the stars before time runs out, and try not to get gleaned.

## Running

No build step and no dependencies. Open `index.html` in a modern browser.

```sh
xdg-open index.html          # or just double-click it
# or serve it:
python3 -m http.server 8000  # then visit http://localhost:8000
```

## The game

**Win:** settle **5,000,000 humans** on colony worlds before Earth's biosphere collapses in **2271**.
**Lose:** the deadline passes, or every replicant is destroyed.
**Legacy goals** (keep playing after the Exodus): destroy the Gleaner Hive, decode the Precursor Archive,
see the Kethari reach orbit, complete a Dyson Swarm, restore Earth, grow humanity to 25M, and meet all three species.

### Core loop

1. **Mine.** Build Autofactories on planets, belts and gas giants to produce **Matter**. Body richness (⛏) sets the yield.
2. **Replicate.** Spend Matter to clone yourself. Each clone gets a name and a personality trait
   (Explorer, Tinkerer, Builder, Warrior, Stalwart, Frugal). Personality drift is a feature.
3. **Explore.** Probes survey systems when they arrive. Look for habitable worlds (≥70% habitability)
   and terraforming candidates. About 17% of systems hold anomalies (derelicts, data caches, comet swarms…).
4. **Research.** Every replicant produces research. Labs and Observation Posts add more. 19 techs across
   Industry, Exploration, Military and Colonization.
5. **Terraform.** Terraformers push a planet's habitability toward its maximum. Mars is your first candidate.
6. **Evacuate.** Research Colony Ship Design, build Orbital Shipyards at Sol, and send colony ships to
   habitable worlds. Colonies grow on their own.
7. **Defend.** Rival Hegemony probes prowl near Sol early on. Around 2181 the Gleaners start sending harvester
   fleets from their Hive at the rim. They creep toward Sol, strip undefended systems, wipe out colonies and
   exterminate native species. Use Defense Platforms and armed probes (Interceptors → Shields → Lance → Antimatter).

### Story systems

- **Convergences** every ~10 years: all copies sync up and pick one of three boons.
- **First contact** with the Kethari (Bronze Age amphibians), the Vellani (advanced, cautious traders) and the
  Thrynn (refugees who know where the Gleaner Hive is). Each one offers a choice. The Kethari develop over
  time toward spaceflight, if the Gleaners don't get them first.
- **Random events** every few years (`js/events.js`): flares, rogue planets, colony outbreaks and comets,
  personality drift, clone feuds, a clone who wants to leave for the deep dark (and may come back),
  Hegemony defectors, Vellani convoys, distress beacons and more. About half need a decision.
- **The Precursor Archive:** five relics scattered in widening rings. Each one points to the next and tells
  part of the story of who built the Gleaners. Decoding all five forces a big choice.
- **After the Exodus:** Planetary Restoration lets Terraformers bring Earth back. Stellar Engineering
  unlocks Dyson Swarm Segments.
- **Earth news** marks the countdown. The journal log is written in the probe's own snarky voice.

### Controls

| Input | Action |
|---|---|
| Left-click | Select star / traveling probe |
| **Right-click star** | Move selected probe there |
| Drag / wheel | Pan / zoom (Shift+wheel zooms faster) |
| Space | Pause / resume |
| 1–4 | Game speed |
| Tab | Next idle probe |
| M | Move mode for selected probe |
| R | Research screen |
| H / ? | Help |
| Esc | Cancel / close / deselect |
| Home | Recenter on Sol |

The game auto-pauses when a fight involving your probes breaks out, and whenever an event needs a decision.
The **Auto-pause** toggles in the top bar can also pause when a clone goes idle (it gets selected for you) or the research queue runs out. These preferences are remembered per browser.
It autosaves to `localStorage` every 5 game-years. **Save** also saves manually, and **Continue** on the title screen loads the save.

## Code layout

```
index.html        layout shell
css/style.css     theme
js/data.js        tuning constants, techs, structures, star catalog, flavor text
js/galaxy.js      seeded RNG + galaxy generation (real nearby stars + procedural fill)
js/sim.js         all game rules: actions, economy, combat, AI, story, legacy goals (DOM-free)
js/events.js      random events and their delayed follow-ups (DOM-free)
js/render.js      canvas galaxy map
js/ui.js          panels, modals, log, research tree
js/main.js        game loop, input, save/load
tools/simtest.js  headless balance harness: a bot plays full games
```

`sim.js` has no DOM access, so the whole game can run headless:

```sh
node tools/simtest.js 8      # 8 seeded games; add `v` for decade-by-decade stats
```

Balance target: a tuned bot that micro-manages perfectly wins around 2213–2225. That leaves a
human player roughly 45 years of slack. A passive player is overrun by the Others around 2190.

## MVP scope and future ideas

The MVP is in: exploration, replication with traits, economy, the research tree, terraforming,
colonization, two hostile factions with combat, three alien species, Convergences, anomalies, random events,
legacy goals, win and loss conditions, and save/load.

Ideas for later: per-system resource logistics, player-designed fleets and an attack-move order, diplomacy
with the Vellani, a Hegemony home system to conquer, megastructures, sound,
and difficulty settings.

Old saves load: `S.migrate` renames old tech ids and places the Precursor relics in unexplored systems.
