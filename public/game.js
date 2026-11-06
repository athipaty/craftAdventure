"use strict";

// =====================================================================
// Gear Fight! — a gear machine that runs by itself. One gear has a single
// tooth and keeps turning on its own. Each time that tooth hits a neighbouring
// gear, that gear and every gear connected to it gain 25%, like a gear train.
// At 100% a gear sends one soldier to the battle and starts again from 0%,
// staying where it is. A run starts with just one normal gear beside the
// one-tooth gear. Soldiers can be spent on more gears, which the player drags
// into place to connect them. The player's soldiers join the front line at
// once; the enemy's march there and only count once they arrive. Winning a
// wave offers a choice of three rewards, including special gears that make placement matter. Every
// fifth wave is a boss with a health bar, who rusts gears to break the chain.
// Runs and quests earn coins, spent in the Workshop on upgrades that last
// between runs. Every run also earns experience toward a player level, and
// lifetime totals unlock achievements. Runs happen in worlds, each with its own
// enemies and a final boss; beating one unlocks the next. Coins and levels also
// unlock heroes and colours, and a weekly challenge changes the rules.
// Tips pause the game the first time something new happens. Training raises the
// army's rank, so each soldier is worth more; prices are counted in soldiers of
// the current rank, so a stronger army doesn't make everything free.
// Two independent systems tied together by one number:
//   - the board (grid[][]) is the gear machine
//   - the battle (playerPower/enemyPower) is a simple push-the-line meter
// Everything here is client-only — no backend, no login. The best wave reached,
// coins, upgrades, quests, level, achievements, tips seen and the mute setting
// live in localStorage, and so does the run in progress, so closing the game
// doesn't lose it.
// =====================================================================

const COLS = 7;
const ROWS = 7;
const BASE_POWER = 3;
const WIN_RATIO = 0.7; // playerPower share of the total needed to take the wave
const LOSE_RATIO = 0.3; // playerPower share at/below which the enemy overruns you
const TRAIN_KEEP_SHARE = 0.4; // training can't take the player's share of the line below this
const GEAR_BASE_COST = 3; // soldiers a gear is worth with an empty board
const GEAR_COST_GROWTH = 1.15; // what a gear is worth when scrapped grows with each one on the board
const DRIVER_ROW = Math.floor(ROWS / 2);
const DRIVER_COL = Math.floor(COLS / 2);
const MARCH_SECONDS = 0.9; // how long a soldier takes to reach the front line
const MARCH_ARRIVED = 1; // a marcher's progress once it has reached the front line
const MAX_MARCHERS = 24; // per army; past this, new soldiers join the newest one
const CLASH_SECONDS = 0.3;
const MAX_PARTICLES = 200;
const MAX_CANVAS_SCALE = 2; // sharper screens are drawn at this scale, to keep phones smooth
const MAX_FALLERS = 2;
const FALLER_GAP_MS = 600; // fighters fall at most this often, so the two at the front stay easy to see
const FALLER_START_GAP = 46; // pixels from the front line, behind the fighter
const FALLER_ALPHA = 0.6;
const STRIKE_COOLDOWN_SECONDS = 2;
const STRIKE_OUTPUT_SECONDS = 0.5; // a strike is worth this much of the machine's output
const VICTORY_MS = 900; // the armies react to a win before the reward choice appears
const HIT_STOP_SECONDS = 0.07; // a tiny freeze that gives big hits weight
const HIT_NUMBER_SECONDS = 0.9;
const FIGHT_HIT_SECONDS = 0.5; // each side's losses show as one number this often
const FIGHT_BIG_HIT = 0.08; // a loss this big a share of an army shows at once
const HIT_NUMBER_RISE = 18; // pixels per second
const HIT_NUMBER_GAP = 68; // pixels from the front line, clear of the fighter
const HIT_NUMBER_BOSS_GAP = 98; // bosses are wider
const HIT_NUMBER_MARGIN = 26; // kept from the edges of the lane
const SHAKE_FADE_PER_SEC = 24; // pixels of screen shake lost per second
const BOMB_SHAKE = 5; // pixels
const SAVE_KEY = "gearfight_save";
const RUN_SAVE_KEY = "gearfight_run";
// Lifetime waves won before each feature appears, so a new player meets them one
// at a time. Anyone past these numbers simply has them all.
const HINT_WAVES = 10; // the how-to line under the buttons shows until this many waves are won
const FEATURE_WAVES = { reroll: 3, rare: 3, rally: 4, train: 6, speed: 6, newGears: 8, deal: 10, powerGears: 12 };
const FEATURE_NEWS = { reroll: "New: Rerolls and skips!", rare: "New: Rare rewards!", rally: "New: Rally!", train: "New: Training!", speed: "New: 2x speed!", newGears: "New: Far and Lone gears!", deal: "New: Risky deals!", powerGears: "New: Spark, Oil and Ice gears!" };
const TIP_FEATURES = { rally: "rally", train: "train" };
const EASY_BOSS = 0.65; // boss health and reinforcements on Easy
// One icon per reward, skill and word, the same wherever it appears. Gears, enemies
// and bosses use their real art instead.
const REWARD_ICONS = {
  fasterGear: "\u23E9", veterans: "\u{1F396}\uFE0F", reinforcements: "\u{1F6A9}",
  cooling: "\u{1F9CA}", staticCharge: "\u26A1", scrapDealer: "\u267B\uFE0F", thickOil: "\u{1F6E2}\uFE0F", warChest: "\u{1F4B0}",
  drillManual: "\u{1F4D8}", piercing: "\u{1F531}", antifreeze: "\u2744\uFE0F", fireproof: "\u{1F9EF}", longChain: "\u{1F517}",
  bossHunter: "\u{1F3AF}", demolition: "\u{1F4A3}", heavyLoad: "\u{1F3CB}\uFE0F", turbo: "\u{1F680}", blastCleaner: "\u{1F9F9}",
  stormEngine: "\u{1F329}\uFE0F", warDrums: "\u{1F941}", patterns: "\u{1F9E9}", forgeBonus: "\u{1F528}", forgedGear: "\u2692\uFE0F",
  chargedStrike: "\u{1F31F}", secondWind: "\u{1F4A8}", promotion: "\u2B50", clockwork: "\u23F0",
};
// Icons for the non-reward status chips (statusChips() below) \u2014 rewards
// already have an icon via REWARD_ICONS, these cover the rest.
const STATUS_ICONS = {
  frozen: "\u2744\uFE0F",
  deal: "\u{1F91D}",
  overdrive: "\u{1F680}",
  rally: "\u{1F6A9}",
  doubleEvent: "2\uFE0F\u20E3",
  guardian: "\u{1F6E1}\uFE0F",
  spark: "\u26A1",
  chill: "\u{1F9CA}",
  pace: { rush: "\u{1F3C3}", siege: "\u{1F3F0}" },
};
const GUIDE_ICON_SIZE = 48;
const COUNTER_HOLD_SECONDS = 0.5; // lightning must have been ready this long, so tapping nonstop can't counter
const BUILD_SECONDS = 5; // the break between waves
const BUILD_MIN_GEARS = 3; // smaller machines have nothing to rearrange
const DEAL_FIRST_WAVE = 3;
const DEAL_CHANCE = 0.35;
const DEAL_BASE_COINS = 5;
const STAR_COINS = 25;
const STAR_MAX_GEARS = 8;
const BACKUP_FORMAT = "gearfight_backup";
const BACKUP_VERSION = 1;
const AWAY_MIN_MINUTES = 30; // shorter gaps pay nothing
const AWAY_MAX_HOURS = 8;
const AWAY_COINS_PER_HOUR = 4; // plus one per player level
const DAILY_GOAL_WAVE = 10; // reach this in the daily challenge for its coins
const DAILY_GOAL_COINS = 60;
const HERO_LEVEL_WAVES = [0, 10, 30, 60, 100]; // waves won with a hero to reach each level
const HERO_LEVEL_SPEED = 0.02; // main gear speed per hero level after the first
const KNIGHT_RALLY_SECONDS = 3;
const ARCHER_TRIPLE_EVERY = 3; // this strike hits three times as hard
const BERSERKER_OVERDRIVE_SOLDIERS = 2;
const FAR_PAYOUT_PER_STEP = 0.25;
const LONE_PAYOUT_PER_SIDE = 0.5;
const RULE_RUST_SECONDS = 12;
const RULE_SLOW_OVERDRIVE = 1.5;
const RULE_SWARM = 1.25;
const RULE_BOSS_EVERY = 4;
const WARLORD_REINFORCE_SHARE = 0.12; // of the enemy's army, per attack
const WYRM_DRAIN = 0.5; // share of each gear's progress left after an attack
const QUEEN_FREEZE_SECONDS = 5;
const MAGMA_MIN_GEARS = 6; // the Magma King only melts gears from a machine bigger than this
const FINAL_BOSS_DRAW_SCALE = 1.25;
const PACE_FIRST_WAVE = 4;
const PACE_CHANCE = 0.35;
const REROLLS_PER_RUN = 2;
const SKIP_COINS = 3; // paid for passing on a reward choice
const HEAD_START_WAVE = 6; // cleared worlds can start here
const HEAD_START_GEARS = 6; // free gears that make up for the waves skipped
const BUZZ_GAP_MS = 150; // vibration at most this often
// Drops are the only way to grow the machine, so every normal wave has one, early
// enough that a quick wave doesn't end first.
const GEAR_DROP_EARLIEST = 3; // seconds into the wave
const GEAR_DROP_LATEST = 8;
const AURA_SIZE = 1.42; // of a cell, so it shows around the gear
const AURA_BASE_ALPHA = 0.55;
const AURA_ALPHA_PER_BOOST = 0.3;
// Winning waves quickly spins the main gear faster, like a small Overdrive that
// lasts as long as the player keeps it up. It isn't counted in the machine's
// output, or the next waves would be sized to it and cancel it out.
const STREAK = { fastSeconds: 10, perLevel: 0.05, maxLevel: 5 };
// What a boss's chests can hold. weight: how often it comes up.
const CHEST_PRIZES = [
  { id: "coins", weight: 50, coins: 15 },
  { id: "moreCoins", weight: 25, coins: 30 },
  { id: "gear", weight: 15, level: 2 },
  { id: "bigGear", weight: 7, level: 3, rare: true },
  { id: "jackpot", weight: 3, coins: 75, rare: true },
];
const CHEST_COUNT = 3;
const CHEST_FULL_TRAY_COINS = 20; // paid for a gear when the tray has no room
const CHEST_OPEN_MS = 750; // the chosen chest rattles, harder and harder, before it opens
const CHEST_LID_MS = 380; // how long a lid takes to fly open
const CHEST_REVEAL_MS = 650; // then the others open one by one, to show what was missed
const CHEST_ART_SCALE = 2; // chests are drawn big on their cards
// A route to choose for the next wave: the risk is paid during it, the reward
// when it's won, unless it says otherwise.
const PATH_FIRST_WAVE = 3;
const PATH_GAP_WAVES = 3; // waves between choices at the least
const PATH_ELITE_FIRST_WAVE = 8; // earlier, it's a trap for a machine that's still small
const PATHS = {
  safe: { id: "safe", icon: "\u{1F6E1}\uFE0F", name: "Safe road", risk: "No extra danger", reward: "No bonus" },
  elite: { id: "elite", icon: "\u2694\uFE0F", name: "Elite ambush", risk: "40% more enemies", reward: "Win for better reward choices", enemy: 1.4, lucky: true, available: () => wave >= PATH_ELITE_FIRST_WAVE },
  treasure: { id: "treasure", icon: "\u{1F4B0}", name: "Treasure trail", risk: "Enemies grow 25% faster", reward: "A treasure goblin, and win for +10 coins", growth: 1.25, goblin: true, coins: 10 },
  supply: { id: "supply", icon: "\u{1F4E6}", name: "Supply camp", risk: "20% more enemies", reward: "A level 2 gear right now", enemy: 1.2, gearLevel: 2, available: () => gearTray.length < TRAY_SLOTS },
};
const GOBLIN_TIP_AGE = 1.2; // seconds in, so it's on screen when the tip points to it
const GOBLIN_FIRST_WAVE = 2;
const GOBLIN_WAVE_CHANCE = 0.2; // odds a normal wave has a treasure goblin, about three a run
const GOBLIN_EARLIEST = 4; // seconds into the wave
const GOBLIN_LATEST = 9;
const GOBLIN_SECONDS = 4.5; // to cross the battle
const GOBLIN_SECONDS_EASY = 6.5;
const GOBLIN_GEAR_CHANCE = 0.3; // otherwise it carries coins
const GOBLIN_COINS_MIN = 5;
const GOBLIN_COINS_MAX = 10;
const SPECIAL_DROP_CHANCE = 0.15; // about three a run; the rest are soldier gears
const TRAY_SLOTS = 5; // gears waiting below the board; a drop waits its turn when it's full
const TAP_SLOP = 10; // pixels a press can move and still count as a tap
const BOSS_DROP_HEALTH = 0.5; // every boss drops a better gear when it falls this low
const BOSS_DROP_LEVEL = 2;
const NO_GEAR_DROP = -1;
const CROWD_MAX = 10; // soldiers drawn behind each fighter
const CROWD_FIRST_GAP = 30; // pixels behind the fighter, so it stays in plain view
const CROWD_BOSS_GAP = 42;
const CROWD_SPACING = 13;
const CROWD_SCALE = 0.62;
const CROWD_SPRITE_SIZE = 64;
const RUN_SAVE_VERSION = 1; // saves from another version are ignored
const RUN_SAVE_SECONDS = 5; // how often a run is saved while playing
const RUN_SAVE_STATES = ["playing", "building", "choosing", "chest", "path", "tip", "paused", "worldclear"];
const COINS_PER_WAVE = 2;
const COINS_PER_BOSS = 10;
const COIN_PURSE_PER_LEVEL = 0.1; // extra run coins per level
const STRIKE_POWER_PER_LEVEL = 0.25;
const STRIKE_RECHARGE_PER_LEVEL = 0.25; // seconds off the recharge per level
const OVERDRIVE_RECHARGE_PER_LEVEL = 3; // seconds off the recharge per level
const RUST_GUARD_PER_LEVEL = 0.05; // share of gears rusted per attack removed by each level
const TRAIN_DISCOUNT_PER_LEVEL = 0.1;
const XP_PER_RUN = 5; // even a run that wins nothing counts for something
const XP_PER_WAVE = 10;
const XP_PER_BOSS = 40;
const XP_PER_QUEST = 20;
const XP_LEVEL_BASE = 100; // experience needed for level 2
const XP_LEVEL_STEP = 50; // how much more each level after that needs
const LEVEL_COINS_BASE = 10;
const LEVEL_COINS_STEP = 3;
const UPGRADE_PRICE_SCALE = 1.5;
const ANNOUNCEMENT_MS = 1600;
const COUNTED_RUN_SECONDS = 30; // restarting at once doesn't count as a run
const PLAYER_TITLES = [
  { fromLevel: 1, name: "Apprentice" },
  { fromLevel: 5, name: "Mechanic" },
  { fromLevel: 10, name: "Engineer" },
  { fromLevel: 20, name: "Gearsmith" },
  { fromLevel: 30, name: "Master Gearsmith" },
  { fromLevel: 50, name: "Gear Legend" },
];
// Lifetime totals that keep the highest value reached instead of adding up.
const BEST_STATS = ["bestStreak", "stars", "worldTier", "owned", "worlds", "topLevel", "rank", "reachWave", "cleanWave", "questsDone", "streak", "upgrades"];
const ACHIEVEMENTS = [
  { id: "world1", name: "Out of the woods", text: "Clear Green Forest", stat: "worlds", target: 1, coins: 30 },
  { id: "world2", name: "Sun proof", text: "Clear Sun Desert", stat: "worlds", target: 2, coins: 60 },
  { id: "world3", name: "Cold blooded", text: "Clear Frozen Peaks", stat: "worlds", target: 3, coins: 100 },
  { id: "world4", name: "Gear Fight champion", text: "Clear Lava Core", stat: "worlds", target: 4, coins: 200 },
  { id: "fusions5", name: "Mad inventor", text: "Fuse gears 5 times", stat: "fusions", target: 5, coins: 40 },
  { id: "streak5", name: "On fire!", text: "Reach a hot streak of 5", stat: "bestStreak", target: 5, coins: 40 },
  { id: "chests10", name: "Treasure hunter", text: "Open 10 boss chests", stat: "chests", target: 10, coins: 40 },
  { id: "goblins10", name: "Gotcha!", text: "Catch 10 treasure goblins", stat: "goblins", target: 10, coins: 40 },
  { id: "counter10", name: "Quick draw", text: "Counter 10 boss attacks", stat: "counters", target: 10, coins: 40 },
  { id: "counter50", name: "Untouchable", text: "Counter 50 boss attacks", stat: "counters", target: 50, coins: 120 },
  { id: "stars12", name: "Star engineer", text: "Earn all 12 world stars", stat: "stars", target: 12, coins: 250 },
  { id: "deal10", name: "Risk taker", text: "Win 10 risky deals", stat: "deals", target: 10, coins: 60 },
  { id: "tier2", name: "Not so hard", text: "Clear a world on Hard", stat: "worldTier", target: 2, coins: 150 },
  { id: "tier3", name: "Expert engineer", text: "Clear a world on Expert", stat: "worldTier", target: 3, coins: 300 },
  { id: "daily1", name: "Daily driver", text: "Reach the goal of a daily challenge", stat: "dailyGoals", target: 1, coins: 30 },
  { id: "daily7", name: "Habit forming", text: "Reach the goal of 7 daily challenges", stat: "dailyGoals", target: 7, coins: 120 },
  { id: "event1", name: "Challenger", text: "Finish a weekly challenge", stat: "events", target: 1, coins: 30 },
  { id: "event5", name: "Week after week", text: "Finish 5 weekly challenges", stat: "events", target: 5, coins: 100 },
  { id: "owned5", name: "Collector", text: "Unlock 5 heroes or colours", stat: "owned", target: 5, coins: 40 },
  { id: "wave1", name: "First win", text: "Win a wave", stat: "waves", target: 1, coins: 10 },
  { id: "wave50", name: "Veteran", text: "Win 50 waves", stat: "waves", target: 50, coins: 30 },
  { id: "wave250", name: "Warlord", text: "Win 250 waves", stat: "waves", target: 250, coins: 75 },
  { id: "wave1000", name: "Unstoppable", text: "Win 1,000 waves", stat: "waves", target: 1000, coins: 150 },
  { id: "reach10", name: "Getting serious", text: "Reach wave 10", stat: "reachWave", target: 10, coins: 15 },
  { id: "reach20", name: "Deep run", text: "Reach wave 20", stat: "reachWave", target: 20, coins: 30 },
  { id: "reach30", name: "Long haul", text: "Reach wave 30", stat: "reachWave", target: 30, coins: 60 },
  { id: "reach40", name: "Beyond the wall", text: "Reach wave 40", stat: "reachWave", target: 40, coins: 120 },
  { id: "boss1", name: "Giant slayer", text: "Beat a boss", stat: "bosses", target: 1, coins: 15 },
  { id: "boss10", name: "Boss hunter", text: "Beat 10 bosses", stat: "bosses", target: 10, coins: 40 },
  { id: "boss50", name: "Boss nightmare", text: "Beat 50 bosses", stat: "bosses", target: 50, coins: 100 },
  { id: "merge1", name: "Better together", text: "Merge two gears", stat: "merges", target: 1, coins: 10 },
  { id: "merge100", name: "Merge master", text: "Merge gears 100 times", stat: "merges", target: 100, coins: 50 },
  { id: "level5", name: "Top gear", text: "Make a level 5 gear", stat: "topLevel", target: 5, coins: 40 },
  { id: "knight", name: "Arise, Knights", text: "Train your army to Knights", stat: "rank", target: 1, coins: 15 },
  { id: "champion", name: "Champions", text: "Train your army to Champions", stat: "rank", target: 2, coins: 30 },
  { id: "hero", name: "Heroes", text: "Train your army to Heroes", stat: "rank", target: 3, coins: 60 },
  { id: "strike100", name: "Storm caller", text: "Use 100 lightning strikes", stat: "strikes", target: 100, coins: 30 },
  { id: "blast100", name: "Demolition", text: "Blast 100 enemies with bombs", stat: "blasted", target: 100, coins: 30 },
  { id: "combo1", name: "Pattern spotter", text: "Make a combo", stat: "combos", target: 1, coins: 15 },
  { id: "combo25", name: "Combo builder", text: "Make 25 combos", stat: "combos", target: 25, coins: 40 },
  { id: "clean10", name: "No shortcuts", text: "Reach wave 10 without using Overdrive", stat: "cleanWave", target: 10, coins: 40 },
  { id: "rust25", name: "Rust remover", text: "Fix 25 rusted gears", stat: "rustFixed", target: 25, coins: 25 },
  { id: "scrap10", name: "Clean workshop", text: "Scrap 10 gears", stat: "scraps", target: 10, coins: 15 },
  { id: "quest10", name: "Reliable", text: "Finish 10 quests", stat: "questsDone", target: 10, coins: 30 },
  { id: "quest50", name: "Quest master", text: "Finish 50 quests", stat: "questsDone", target: 50, coins: 80 },
  { id: "streak7", name: "One full week", text: "Reach a 7-day streak", stat: "streak", target: 7, coins: 40 },
  { id: "run10", name: "Back for more", text: "Play 10 runs", stat: "runs", target: 10, coins: 20 },
  { id: "run50", name: "Regular", text: "Play 50 runs", stat: "runs", target: 50, coins: 60 },
  { id: "upgrades10", name: "Well equipped", text: "Buy 10 Workshop upgrades", stat: "upgrades", target: 10, coins: 30 },
];
const FINAL_BOSS_HP = 1.5; // final bosses have this much more health than a normal boss
const WORLD_CLEAR_XP = 100;
const REPEAT_CLEAR_COINS = 20;
const RUNNER_SHARE = 0.12; // extra enemies per second, as a share of the machine's best output
const BRUTE_SOLDIER_DAMAGE = 0.75; // soldiers count for this much against armoured brutes
const ENEMY_POWER_SECONDS = 9; // time between enemy special moves
const FROST_SECONDS = 4; // how long a freeze lasts
const FROST_SLOW = 0.5; // main gear speed while frozen
const IMP_GEARS_BURNED = 2; // gears that lose their progress per attack

// A wave's enemy. look: which fighter to draw. fromWave: first wave it can appear.
const ENEMY_TYPES = {
  goblin: { id: "goblin" },
  runner: { id: "runner", name: "Goblin runners", look: "runner" },
  brute: { id: "brute", name: "Armoured brutes", look: "brute" },
  shaman: { id: "shaman", name: "Rust shamans", look: "shaman" },
  frost: { id: "frost", name: "Frost trolls", look: "frost" },
  imp: { id: "imp", name: "Fire imps", look: "imp" },
};

// finalWave: beat this wave's boss to clear the world. scale: how much bigger each
// wave starts. clearCoins: paid the first time. theme: how the battlefield looks.
const WORLDS = [
  {
    id: "forest", name: "Green Forest", finalHp: 1.5, finalWave: 15, scale: 1.55, clearCoins: 100,
    enemies: [["goblin", 1], ["runner", 6]],
    theme: { skyTop: "#58b8ee", skyBottom: "#c6ecfb", hillBack: "#8ed36a", hillFront: "#6fbf4e", ground: "#57a63a", groundDark: "#4a9231", deco: "trees" },
  },
  {
    id: "desert", name: "Sun Desert", finalHp: 1.5, finalWave: 20, scale: 1.6, clearCoins: 200,
    enemies: [["goblin", 1], ["runner", 3], ["brute", 6]],
    theme: { skyTop: "#f0a64f", skyBottom: "#fbe6b0", hillBack: "#e8c27a", hillFront: "#d9a95c", ground: "#c9954a", groundDark: "#b5823c", deco: "cactus" },
  },
  {
    id: "ice", name: "Frozen Peaks", finalHp: 1.25, finalWave: 25, scale: 1.56, clearCoins: 400,
    enemies: [["frost", 1], ["runner", 3], ["brute", 8], ["shaman", 12]],
    theme: { skyTop: "#8fb8e0", skyBottom: "#eaf6ff", hillBack: "#dcecf8", hillFront: "#c2dcef", ground: "#e8f2fa", groundDark: "#cfe2f0", deco: "snow" },
  },
  {
    id: "lava", name: "Lava Core", finalHp: 1.25, finalWave: 25, scale: 1.6, clearCoins: 800,
    enemies: [["imp", 1], ["shaman", 4], ["brute", 8], ["frost", 14]],
    theme: { skyTop: "#2a1020", skyBottom: "#a8381c", hillBack: "#4a2020", hillFront: "#301418", ground: "#3a2018", groundDark: "#2a1610", deco: "embers" },
  },
];
// Offered on the reward screen. Winning the next wave pays extra; losing it costs
// nothing but the risk of the run.
const WAVE_DEALS = {
  army: { id: "army", text: "50% more enemies", enemy: 1.5 },
  swarm: { id: "swarm", text: "enemies grow 50% faster", growth: 1.5 },
  dark: { id: "dark", text: "no lightning", noStrike: true },
};
// Each adds one gear at the start of every run, so a run can be planned from wave 1.
const START_GEARS = [
  { id: "none", name: "Just the usual", text: "No extra gear", cost: 0, level: 1, gear: null },
  { id: "booster", name: "Booster gear", text: "Start each run with a Booster gear too", cost: 100, level: 3, gear: "booster", swatch: "#6fb83f" },
  { id: "big", name: "Big gear", text: "Start each run with a Big gear too", cost: 150, level: 5, gear: "big", swatch: "#4f8fd0" },
  { id: "bomb", name: "Bomb gear", text: "Start each run with a Bomb gear too", cost: 200, level: 7, gear: "bomb", swatch: "#cf5238" },
  { id: "far", name: "Far gear", text: "Start each run with a Far gear too", cost: 250, level: 9, gear: "far", swatch: "#8a5ad0" },
  { id: "lone", name: "Lone gear", text: "Start each run with a Lone gear too", cost: 300, level: 11, gear: "lone", swatch: "#35a890" },
];
// Rules that change a run, for a world's harder levels and the daily challenge.
const RULES = {
  rusty: "rust attacks on every wave",
  bossy: "a boss every 4 waves",
  slowOverdrive: "Overdrive recharges slower",
  swarm: "enemies grow 25% faster",
};
// Level 0 is the world as it is. scale: added to how much bigger each wave starts.
// waveSeconds: multiplies how long the machine's best output takes to win a wave,
// which is what sets a wave's size once a machine is big. growth: how fast enemies
// grow during a wave. lead: taken from the army a wave starts with, so the line
// starts closer to losing. bossHp: extra boss health.
const WORLD_LEVELS = [
  { name: "Normal", scale: 0, waveSeconds: 1, growth: 1, lead: 0, bossHp: 1, coins: 1, clearCoins: 1 },
  { name: "Hard", scale: 0.04, waveSeconds: 1.6, growth: 1.5, lead: 0.1, bossHp: 1.4, coins: 1.25, clearCoins: 1.5 },
  { name: "Expert", scale: 0.08, waveSeconds: 2, growth: 2, lead: 0.2, bossHp: 2, coins: 1.5, clearCoins: 2 },
];
// For anyone who'd rather see every world than be tested by them. Earns less, and
// only the first star.
const EASY_LEVEL = { name: "Easy", scale: -0.08, waveSeconds: 0.8, growth: 0.75, lead: -0.1, bossHp: 0.8, coins: 0.75 };
const WORLD_STORIES = {
  forest: { teaser: "Goblins have overrun the trees. But who is leading them?", intro: "Goblins have overrun the Green Forest! Build a machine, send your soldiers, and drive them out.", outro: "The forest is safe. But the goblins left tracks heading for the desert..." },
  desert: { teaser: "Tracks vanish into the dunes. Something huge moves below the sand.", intro: "The goblins fled to the Sun Desert, and armoured brutes have joined them. Your machine must grow.", outro: "The Sand Wyrm sinks beneath the dunes. Far away, the mountains have turned white." },
  ice: { teaser: "The mountains have turned white, and the cold is spreading.", intro: "High in the Frozen Peaks, frost trolls freeze everything they touch. Keep your gears turning.", outro: "The Frost Queen falls and the ice begins to crack. Something burns below the world." },
  lava: { teaser: "Something burns below the world. This is where it all began.", intro: "All of this began at the Lava Core. Fire imps guard it, and the Magma King waits below. End it here.", outro: "The Magma King is beaten, and the machines fall silent. Peace, at last... for now." },
};
const BOSS_TAUNTS = {
  rust: "Your gears will crumble to dust!",
  wall: "You shall not build here!",
  scramble: "Let's mix things up!",
  shield: "Nothing gets through my shield!",
  warlord: "This forest is mine! Attack!",
  wyrm: "The sands will swallow your work!",
  queen: "Everything freezes in the end.",
  magma: "I will melt your machine to slag!",
};
const WORLD_LEVEL_RULES = {
  forest: [[], ["swarm"], ["swarm", "rusty"]],
  desert: [[], ["bossy"], ["bossy", "swarm"]],
  ice: [[], ["slowOverdrive"], ["slowOverdrive", "rusty"]],
  lava: [[], ["swarm"], ["swarm", "bossy"]],
};
// Mixed day by day for the daily challenge, so that everyone gets the same one.
const DAILY_RULE_SETS = [["rusty"], ["swarm"], ["bossy"], ["slowOverdrive"], ["rusty", "swarm"], ["rusty", "slowOverdrive"], ["bossy", "swarm"]];
const EVENT_CLEAR_COINS = 150;
const EVENT_FINAL_WAVE = 15;
const EVENT_BASE_SCALE = 1.55;
const EVENT_RUST_SECONDS = 8;
const ARCHER_STRIKE = 1.5;
const ARCHER_RECHARGE = 0.25; // seconds
const ENGINEER_SPEED = 1.05;
const BERSERKER_OVERDRIVE = 3; // seconds
const GUARDIAN_BOSS = 0.85; // bosses have this share of their health and enemies

// Each hero changes how a run plays. helmet and plume colour the fighter.
const HEROES = [
  { id: "knight", name: "Knight", text: "A full Rally takes 3 seconds, not 5", cost: 0, level: 1, helmet: "#c3ccd5", plume: null },
  { id: "archer", name: "Stormcaller", text: "Lightning hits harder and recharges faster, and every 3rd strike is triple", cost: 150, level: 1, helmet: "#7fb85a", plume: "#ffe14d" },
  { id: "engineer", name: "Engineer", text: "Starts with a Booster gear, main gear 5% faster", cost: 250, level: 3, helmet: "#e0a92e", plume: "#3a7ddb" },
  { id: "berserker", name: "Berserker", text: "Overdrive lasts 3 seconds longer, and soldiers count double during it", cost: 350, level: 5, helmet: "#a32a1c", plume: "#ff8a3d" },
  { id: "guardian", name: "Guardian", text: "Bosses are 15% weaker, and the first rust attack of each wave is blocked", cost: 500, level: 8, helmet: "#e8f2fa", plume: "#8fe7ff" },
];
const ARMY_SKINS = [
  { id: "blue", name: "Blue army", cost: 0, level: 1, tunic: null, swatch: "#3a7ddb" },
  { id: "red", name: "Red army", cost: 60, level: 1, tunic: "#c9402f", trim: "#6e1f10", swatch: "#c9402f" },
  { id: "green", name: "Green army", cost: 60, level: 1, tunic: "#4f9e2c", trim: "#2f6b18", swatch: "#4f9e2c" },
  { id: "purple", name: "Purple army", cost: 120, level: 3, tunic: "#7a4fc4", trim: "#4f2f8c", swatch: "#7a4fc4" },
  { id: "black", name: "Shadow army", cost: 200, level: 6, tunic: "#2f3440", trim: "#14171d", swatch: "#2f3440" },
  { id: "gold", name: "Golden army", cost: 400, level: 10, tunic: "#ffcc33", trim: "#a06d10", swatch: "#ffcc33" },
];
const GEAR_SKINS = [
  { id: "brass", name: "Brass gears", cost: 0, level: 1, palette: null, swatch: "#c99a35" },
  { id: "steel", name: "Steel gears", cost: 80, level: 1, palette: { light: "#dfe5ea", mid: "#9aa7b4", dark: "#4a5560", recess: "#7c8894", hub: "#e8edf2" }, swatch: "#9aa7b4" },
  { id: "copper", name: "Copper gears", cost: 80, level: 1, palette: { light: "#f2b48a", mid: "#c97a45", dark: "#6e3a1c", recess: "#a8602f", hub: "#fbdcc4" }, swatch: "#c97a45" },
  { id: "jade", name: "Jade gears", cost: 150, level: 3, palette: { light: "#a8ecc8", mid: "#3fae7a", dark: "#1a5e40", recess: "#2f8f62", hub: "#d8f8e8" }, swatch: "#3fae7a" },
  { id: "ruby", name: "Ruby gears", cost: 250, level: 6, palette: { light: "#f5a8c0", mid: "#c73a68", dark: "#6e1436", recess: "#a42a52", hub: "#fbdce8" }, swatch: "#c73a68" },
  { id: "amethyst", name: "Amethyst gears", cost: 500, level: 12, palette: { light: "#d8bdf5", mid: "#8a5ad0", dark: "#46257a", recess: "#6f44b0", hub: "#efe2fb" }, swatch: "#8a5ad0" },
];

// A new challenge each week, chosen by the week number.
const WEEKLY_EVENTS = [
  { id: "bombs", name: "Bomb Week", text: "Every gear that drops is a bomb gear" },
  { id: "bossRush", name: "Boss Rush", text: "A boss every 3 waves" },
  { id: "rust", name: "Rust Season", text: "Rust attacks on every wave" },
  { id: "overdrive", name: "Overdrive Week", text: "Overdrive recharges 3x faster, but enemies are stronger", scaleBonus: 0.05 },
];

const ACTIVE_QUESTS = 3;
const DAILY_REWARDS = [10, 15, 20, 25, 30, 40, 75]; // coins for each day of the weekly cycle
const DAILY_QUEST_KINDS = ["waves", "bosses", "merges", "strikes", "blasted"];
const DAILY_QUESTS = 3;
const DAILY_QUEST_SIZE = 0.5; // daily quests are this much of a normal first-tier quest
const QUESTS_PER_TIER = 5; // quests get harder and pay more after this many
const RECRUITS_FIRST_WAVE_PER_LEVEL = 0.1; // extra share of the army in wave 1; level 5 stays under WIN_RATIO
const RECRUITS_LEAD_PER_LEVEL = 0.05; // added to the player's lead in later waves
const BOSS_BREAKER_PER_LEVEL = 0.1; // boss health and reinforcements removed by each level
const SPEED_PER_LEVEL = 0.05; // main gear speed added by each level
const OVERDRIVE_SECONDS_PER_LEVEL = 1;
const BOSS_EVERY_WAVES = 5;
const BOSS_HP_SCALE = 1.5; // boss health vs the soldiers a normal wave would take to win
const BOSS_PRESSURE = 0.1; // enemies the boss brings per second, as a share of the wave's starting army
const BOSS_FIRST_ATTACK_SECONDS = 5;
const BOSS_ATTACK_SECONDS = 8; // time between rust attacks
const BOSS_WARNING_SECONDS = 1; // the boss glows for this long before it attacks
const BOSS_RUST_SHARE = 0.25; // share of working gears rusted by each attack
const BOSS_RUST_MAX_PER_ATTACK = 5; // keeps a big machine possible to repair by hand
const OVERDRIVE_MULTIPLIER = 3; // main gear speed while overdrive is on
const OVERDRIVE_BASE_SECONDS = 5;
const OVERDRIVE_COOLDOWN_SECONDS = 30;
const OVERDRIVE_START_COOLDOWN_SECONDS = 20; // ready from the first second, it wins wave 1 with no gears yet
const TOOTH_COUNT = 12; // teeth drawn per gear — also one tick's worth of visual spin
const TICK_ANGLE = (Math.PI * 2) / TOOTH_COUNT;
const DRIVER_BASE_TURNS_PER_SEC = 1; // how fast the one-tooth gear turns at the start of a run
const QUARTER_TURN = Math.PI / 2;
// Which neighbour the tooth points at after each quarter turn, in canvas
// rotation order (positive angles are clockwise): right, down, left, up.
const TOOTH_DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const MIN_WAVE_SECONDS = 20; // a new wave starts big enough to take the player's best output this long
const ENEMY_BASE_GROWTH = 0.08; // enemy army per second at the start of wave 1
const ENEMY_WAVE_SCALE = 1.2; // enemy growth multiplier per wave
const ENEMY_DOUBLING_SECONDS = 30; // enemy growth doubles every this long within a wave
// Enemy growth in the first waves, compared to the usual. Gentler, so a new
// player with no upgrades can win them before learning Lightning and Overdrive.
const EARLY_WAVE_GROWTH = [0.4, 0.4, 0.5, 0.75];
const WAVE_START_LEAD = 1.25; // player's army vs the enemy's when a new wave begins
const DRIVER_PALETTE = { light: "#dfe5ea", mid: "#8d99a6", dark: "#3f4a55", recess: "#6d7884", hub: "#c3ccd5" };

const GEAR_PALETTE = { light: "#f3d98a", mid: "#c99a35", dark: "#7a5716", recess: "#a97f28", hub: "#f6e6ae" };
const BIG_PALETTE = { light: "#a9d4ff", mid: "#4f8fd0", dark: "#1f4a7a", recess: "#3a74b0", hub: "#d8ecff" };
const BOOSTER_PALETTE = { light: "#c8f59a", mid: "#6fb83f", dark: "#2f6d18", recess: "#559a2c", hub: "#e4fbc9" };
const RUST_PALETTE = { light: "#a58a78", mid: "#6e5343", dark: "#33241b", recess: "#594234", hub: "#c9b3a3" };
const BOMB_PALETTE = { light: "#ffb3a0", mid: "#cf5238", dark: "#6e1f10", recess: "#ad3f28", hub: "#ffe0d6" };

// hits: how many hits fill the gear (0 means it never fills). A full gear
// sends `soldiers` or blasts `enemies`. A booster gives the gears touching it
// one extra hit each time they are hit.
const FAR_PALETTE = { light: "#d8bdf5", mid: "#8a5ad0", dark: "#46257a", recess: "#6f44b0", hub: "#efe2fb" };
const LONE_PALETTE = { light: "#a8ecd8", mid: "#35a890", dark: "#155e50", recess: "#278a76", hub: "#d8f8ee" };
const CANNON_PALETTE = { light: "#ffd27a", mid: "#e0701c", dark: "#7a3208", recess: "#b85614", hub: "#ffeccb" };
const DYNAMO_PALETTE = { light: "#b8f5ea", mid: "#2fa8c0", dark: "#10525e", recess: "#23859a", hub: "#def9f4" };
const COMET_PALETTE = { light: "#f5b8e8", mid: "#c04aa8", dark: "#5e1650", recess: "#9a3a88", hub: "#fbe0f5" };
const HERMIT_PALETTE = { light: "#d5e0a0", mid: "#7f9a35", dark: "#3c4d12", recess: "#667d28", hub: "#eef4cf" };
const SPARK_PALETTE = { light: "#fff6a0", mid: "#f2c418", dark: "#7a5a00", recess: "#c99a0c", hub: "#fffbd6" };
const OIL_PALETTE = { light: "#9aa3ad", mid: "#3d4652", dark: "#14181e", recess: "#2a313b", hub: "#c9d0d8" };
const ICE_PALETTE = { light: "#e6fbff", mid: "#7fd3f0", dark: "#1f6f8f", recess: "#5ab6d6", hub: "#f6feff" };
const STORM_PALETTE = { light: "#e2c8ff", mid: "#8a4fe0", dark: "#3a1478", recess: "#6c38b8", hub: "#fff3a8" };
const ENGINE_PALETTE = { light: "#c6e8b0", mid: "#4f7a3a", dark: "#1f3414", recess: "#3d6230", hub: "#e2f4d6" };
const BLIZZARD_PALETTE = { light: "#ffffff", mid: "#a9c8ff", dark: "#2f4f9a", recess: "#7fa2e6", hub: "#ffffff" };
const METEOR_PALETTE = { light: "#ffc2a0", mid: "#c8321a", dark: "#4a0a04", recess: "#9a2410", hub: "#ffe14d" };
const TEMPEST_PALETTE = { light: "#c9f2ff", mid: "#3a8fb0", dark: "#102e48", recess: "#2c6f90", hub: "#e9d4ff" };
const FORTRESS_PALETTE = { light: "#e4dccb", mid: "#8a7f68", dark: "#3a3324", recess: "#6e6450", hub: "#ffd23f" };
const REACTOR_PALETTE = { light: "#e2ff9a", mid: "#6fc21f", dark: "#22470a", recess: "#559a18", hub: "#fff3a8" };
// Two different gears of the same level make a new one. Listed either way round.
const FUSIONS = [
  { parts: ["big", "bomb"], gear: "cannon", name: "Cannon gear", text: "Made from a Big gear and a Bomb gear. Fills half as fast, then sends 6 soldiers and blasts 3 enemies" },
  { parts: ["big", "booster"], gear: "dynamo", name: "Dynamo gear", text: "Made from a Big gear and a Booster gear. Fills half as fast, sends 5 soldiers, and boosts the gears touching it" },
  { parts: ["far", "bomb"], gear: "comet", name: "Comet gear", text: "Made from a Far gear and a Bomb gear. Fills half as fast, then blasts 3 enemies, more the farther it is from the main gear" },
  { parts: ["lone", "big"], gear: "hermit", name: "Hermit gear", text: "Made from a Lone gear and a Big gear. Fills half as fast, then sends 6 soldiers, more for each empty space beside it" },
  { parts: ["spark", "bomb"], gear: "storm", name: "Storm gear", text: "Made from a Spark gear and a Bomb gear. Fills half as fast, then blasts 3 enemies and charges your next Lightning" },
  { parts: ["oil", "booster"], gear: "engine", name: "Engine gear", text: "Made from an Oil gear and a Booster gear. Boosts the gears touching it, and none of them can rust" },
  { parts: ["ice", "big"], gear: "blizzard", name: "Blizzard gear", text: "Made from an Ice gear and a Big gear. Fills half as fast, then sends 5 soldiers and slows the enemy's growth" },
  // Super fusions: two fused gears of the same level.
  { parts: ["cannon", "comet"], gear: "meteor", name: "Meteor gear", text: "Super fusion of a Cannon and a Comet. Blasts 10 enemies, more the farther it is from the main gear" },
  { parts: ["storm", "blizzard"], gear: "tempest", name: "Tempest gear", text: "Super fusion of a Storm and a Blizzard. Blasts 6 enemies, charges your next Lightning and slows the enemy" },
  { parts: ["hermit", "engine"], gear: "fortress", name: "Fortress gear", text: "Super fusion of a Hermit and an Engine. Sends 18 soldiers, and neither it nor the gears touching it can rust" },
  { parts: ["dynamo", "storm"], gear: "reactor", name: "Reactor gear", text: "Super fusion of a Dynamo and a Storm. Sends 10 soldiers and blasts 2 enemies, boosts the gears touching it, and charges your next Lightning" },
];
const GEAR_TYPES = {
  soldier: { hits: 4, soldiers: 1, palette: GEAR_PALETTE },
  big: { hits: 8, soldiers: 5, heavy: true, palette: BIG_PALETTE },
  booster: { hits: 0, boosts: true, palette: BOOSTER_PALETTE },
  bomb: { hits: 8, enemies: 2, blast: true, element: "fire", palette: BOMB_PALETTE },
  far: { hits: 4, soldiers: 1, far: true, palette: FAR_PALETTE, mark: "FAR" },
  lone: { hits: 4, soldiers: 1, lone: true, palette: LONE_PALETTE, mark: "LONE" },
  // Made by fusing two others. Each beats the two it came from, and frees a cell.
  cannon: { hits: 8, soldiers: 6, enemies: 3, heavy: true, blast: true, element: "fire", palette: CANNON_PALETTE, mark: "CAN" },
  dynamo: { hits: 8, soldiers: 5, boosts: true, heavy: true, palette: DYNAMO_PALETTE, mark: "DYN" },
  comet: { hits: 8, enemies: 3, blast: true, far: true, element: "fire", palette: COMET_PALETTE, mark: "COM" },
  hermit: { hits: 8, soldiers: 6, heavy: true, lone: true, palette: HERMIT_PALETTE, mark: "HER" },
  // Gears that work with the rest of the game rather than sending soldiers.
  // spark: charges the next Lightning. oil: can't rust, nor can its neighbours.
  // chill: slows the enemy's growth for a while.
  spark: { hits: 4, spark: true, element: "storm", palette: SPARK_PALETTE, mark: "SPK" },
  oil: { hits: 4, soldiers: 1, oil: true, palette: OIL_PALETTE, mark: "OIL" },
  ice: { hits: 6, chill: true, element: "ice", palette: ICE_PALETTE, mark: "ICE" },
  storm: { hits: 8, enemies: 3, blast: true, spark: true, element: "storm", palette: STORM_PALETTE, mark: "STM" },
  engine: { hits: 0, boosts: true, oil: true, palette: ENGINE_PALETTE, mark: "ENG" },
  blizzard: { hits: 8, soldiers: 5, heavy: true, chill: true, element: "ice", palette: BLIZZARD_PALETTE, mark: "BLZ" },
  // Super gears, made by fusing two fused gears. They glow gold.
  meteor: { hits: 8, enemies: 10, heavy: true, blast: true, far: true, element: "fire", super: true, palette: METEOR_PALETTE, mark: "MET" },
  tempest: { hits: 8, enemies: 6, blast: true, spark: true, chill: true, element: "storm", super: true, palette: TEMPEST_PALETTE, mark: "TMP" },
  fortress: { hits: 8, soldiers: 18, heavy: true, oil: true, super: true, palette: FORTRESS_PALETTE, mark: "FRT" },
  reactor: { hits: 8, soldiers: 10, enemies: 2, heavy: true, blast: true, boosts: true, spark: true, element: "storm", super: true, palette: REACTOR_PALETTE, mark: "RCT" },
};
// Fire, ice and storm gears react when two different ones touch: each time
// one of them fills, it sets off the reaction with each neighbour of another
// element. Keyed by the two elements in alphabetical order.
const ELEMENT_COLORS = { fire: "#ff6a2a", ice: "#8fe7ff", storm: "#ffe14d" };
const REACTIONS = {
  "fire+ice": { id: "steam", name: "Steam", icon: "\u2668\uFE0F", colors: ["#ffffff", "#cfe8f0"], text: "Fire and ice gears touching make steam: the enemy stops growing for a moment." },
  "fire+storm": { id: "plasma", name: "Plasma", icon: "\u{1F4A5}", colors: ["#ff6a2a", "#ffe14d"], text: "Fire and storm gears touching make plasma: an extra blast of enemies." },
  "ice+storm": { id: "shatter", name: "Shatter", icon: "\u2744\uFE0F", colors: ["#8fe7ff", "#ffe14d"], text: "Ice and storm gears touching make a shatter: a free lightning hit." },
};
const REACTION_GAP_SECONDS = 1; // a gear sets off reactions at most this often
const STEAM_SECONDS = 1.5; // the enemy doesn't grow at all for this long
const PLASMA_ENEMIES = 2; // blasted per reaction, per level
const SHATTER_SECONDS = 0.5; // a shatter hits like this many seconds of the machine's soldiers, at least one
const SPARK_CHARGE = 0.25; // next Lightning's extra strength each time a spark gear fills, per level
const SPARK_MAX = 2; // so Lightning hits at most 3x as hard
const ICE_SECONDS = 2; // how long a filled ice gear chills the enemy, plus a second per level above 1
const ICE_GROWTH = 0.5; // enemy growth while chilled: slowed, never stopped, so a wave always ends

const DRIVER_SPEED_REWARD = 0.1; // turns per second added by the reward
const VETERANS_REWARD = 0.15; // added to the player's lead each wave
const VETERANS_MAX_LEAD = 1.7; // stays well under the lead that wins a wave outright
const REWARD_CLICK_DELAY_MS = 400; // ignores taps meant for the board when a choice or tip appears
const CHAIN_FALLOFF = 0.85; // strength kept by a hit at each gear it passes through
const CHAIN_MIN_POWER = 0.3; // a long chain never fades below this
const COMBO_LINE_PAYOUT = 1.25; // three matching gears in a row
const COMBO_BLOCK_FILL = 1.25; // four matching gears in a square
const COMBO_RING_BOOST = 2; // a booster with gears on all four sides
const BOSS_WALL_CELLS = 3; // empty cells blocked by each Wall Maker attack
const BOSS_SCRAMBLE_SWAPS = 3; // pairs of gears swapped by each Scrambler attack
const BOSS_SHIELD_TAPS = 5; // taps on the battle to break an Iron Guard shield
// Shown on the reward screen, so the next wave can be planned for.
const NEXT_WAVE_HINTS = {
  rust: "rusts your gears",
  wall: "blocks empty cells",
  scramble: "swaps your gears",
  shield: "raises a shield",
  runner: "extra enemies",
  brute: "soldiers do less",
  shaman: "rusts your gears",
  frost: "freezes the main gear",
  imp: "burns gear progress",
  rush: "extra enemies",
  storm: "rust attacks",
  double: "your soldiers count double",
  blocked: "a row is blocked",
  warlord: "calls reinforcements",
  wyrm: "drains gear progress",
  queen: "freezes the main gear",
  magma: "melts your gears",
  paceRush: "short and fierce",
  paceSiege: "long, pays 5 coins",
};
// Each world's last boss has an attack no other boss has.
const FINAL_BOSSES = {
  forest: { id: "warlord", name: "Goblin Warlord", color: "#3f7d2a", final: true },
  desert: { id: "wyrm", name: "Sand Wyrm", color: "#b5823c", final: true },
  ice: { id: "queen", name: "Frost Queen", color: "#3f7fc0", final: true },
  lava: { id: "magma", name: "Magma King", color: "#c9402f", final: true },
};
// enemy: size of the army at the start. growth: how fast it grows after that.
const WAVE_PACES = {
  rush: { id: "rush", name: "Rush wave", enemy: 0.55, growth: 1.6 },
  siege: { id: "siege", name: "Siege wave", enemy: 1.5, growth: 0.7, coins: 5 },
};
const BOSS_KINDS = [
  { id: "rust", name: "Rust King", color: "#8c1d10" },
  { id: "wall", name: "Wall Maker", color: "#5b4a8a" },
  { id: "scramble", name: "Scrambler", color: "#1d6e6a" },
  { id: "shield", name: "Iron Guard", color: "#59606b" },
];
const RALLY_FULL_SECONDS = 5; // how long to hold the army back to earn the charge bonus
const RALLY_BONUS = 1.5; // charge size after a full rally
const RALLY_CHARGE_START = 0.4; // charges start part-way along the march
const WAVE_EVENT_FIRST_WAVE = 3;
const WAVE_EVENT_CHANCE = 0.4;
const EVENT_RUSH_SHARE = 0.2; // extra enemies per second, as a share of the machine's best soldiers per second
const EVENT_STORM_SECONDS = 8; // time between rust attacks in a storm
// strength: how much one soldier of this rank counts for. trainCost: soldiers
// of the rank before it needed to reach this one.
const ARMY_RANKS = [
  { name: "Recruit", plural: "Recruits", strength: 1, look: "r0" },
  { name: "Knight", plural: "Knights", strength: 3, trainCost: 30, look: "r1" },
  { name: "Champion", plural: "Champions", strength: 9, trainCost: 100, look: "r2" },
  { name: "Hero", plural: "Heroes", strength: 27, trainCost: 300, look: "r3" },
];
// The enemy's rank only changes how its army looks and is counted.
const ENEMY_RANKS = [
  { plural: "Goblins", strength: 1, fromWave: 1, look: "e0" },
  { plural: "Orcs", strength: 3, fromWave: 8, look: "e1" },
  { plural: "Trolls", strength: 9, fromWave: 15, look: "e2" },
  { plural: "Demons", strength: 27, fromWave: 22, look: "e3" },
];
const MAX_GEAR_LEVEL = 5;
const LEVEL_PAYOUT_GROWTH = 2.5; // payout multiplier per level, so merging beats keeping two gears
const TIP_GAP_SECONDS = 25; // play time between tips that aren't urgent
const URGENT_TIP_GAP_SECONDS = 8; // and between urgent ones, or several can land in one boss fight
const MAX_SPECIAL_GEARS = 6; // rewards stop offering special gears at this many on the board
const REINFORCEMENTS_REWARD = 0.2; // added to the player's lead for one wave

// Permanent upgrades. `costs` has one price per level, so its length is the
// highest level.
const UPGRADES = [
  { id: "startGears", name: "Spare gears", text: "Start each run with 1 more gear", costs: [20, 60, 120] },
  { id: "recruits", name: "Recruits", text: "Start every wave with more soldiers", costs: [10, 20, 35, 50, 70] },
  { id: "bossBreaker", name: "Boss breaker", text: "Bosses have 10% less health and help", costs: [40, 90, 160] },
  { id: "speed", name: "Oiled main gear", text: "The one-tooth gear turns 5% faster", costs: [30, 60, 100, 150] },
  { id: "overdrive", name: "Long Overdrive", text: "Overdrive lasts 1 second longer", costs: [25, 60, 110] },
  { id: "extraChoice", name: "Bigger crate", text: "Choose from 4 rewards after each wave", costs: [200] },
  { id: "coinPurse", name: "Coin purse", text: "Earn 10% more coins from each run", costs: [30, 70, 130, 220, 350] },
  { id: "strikePower", name: "Thunder", text: "Lightning strikes hit 25% harder", costs: [25, 60, 110, 180] },
  { id: "strikeRecharge", name: "Quick storm", text: "Lightning recharges 0.25 seconds faster", costs: [40, 100, 200] },
  { id: "overdriveRecharge", name: "Cooling fans", text: "Overdrive recharges 3 seconds faster", costs: [35, 80, 140, 220] },
  { id: "rustGuard", name: "Oil can", text: "Rust attacks hit 5% fewer of your gears", costs: [50, 120, 240] },
  { id: "specials", name: "Spare parts", text: "Rewards can offer 1 more special gear", costs: [60, 150, 300] },
  { id: "drillSergeant", name: "Drill sergeant", text: "Training costs 10% less", costs: [40, 100, 200] },
].map((upgrade) => ({ ...upgrade, costs: upgrade.costs.map((cost) => Math.round(cost * UPGRADE_PRICE_SCALE)) }));

// kind: what counts toward it. best: progress is the highest value reached, not
// a running total. max: the hardest target that makes sense.
const QUEST_KINDS = [
  { kind: "waves", base: 10, coins: 15, text: (n) => `Win ${n} waves` },
  { kind: "bosses", base: 2, coins: 25, text: (n) => `Beat ${n} ${n === 1 ? "boss" : "bosses"}` },
  { kind: "merges", base: 8, coins: 15, text: (n) => `Merge gears ${n} times` },
  { kind: "strikes", base: 15, coins: 10, text: (n) => `Use ${n} lightning strikes` },
  { kind: "blasted", base: 20, coins: 15, text: (n) => `Blast ${n} enemies with bombs` },
  { kind: "combos", base: 3, coins: 20, text: (n) => `Make ${n} combos` },
  { kind: "topLevel", base: 3, coins: 15, best: true, step: 1, max: 5, text: (n) => `Make a level ${n} gear` },
  { kind: "rank", base: 1, coins: 15, best: true, step: 1, max: 3, text: (n) => `Train your army to ${ARMY_RANKS[n].plural}` },
  { kind: "reachWave", base: 10, coins: 30, best: true, step: 5, text: (n) => `Reach wave ${n}` },
  { kind: "cleanWave", base: 6, coins: 25, best: true, step: 3, text: (n) => `Reach wave ${n} without using Overdrive` },
];

// What the rewards below add for each time they are picked.
const PART_COOLING = 0.8; // Overdrive recharge multiplier
const PART_STRIKE = 0.3;
const PART_RUST_SHARE = 0.05;
const MIN_RUST_SHARE = 0.05; // rust attacks always hit at least one gear
const PART_COINS = 0.25;
const PART_TRAIN_COST = 0.75; // training price multiplier
const PART_SCRAP_REFUND = 0.65; // share of a gear's worth paid when it's scrapped
const PART_CHAIN_FALLOFF = 0.05;
const PART_BOSS_DAMAGE = 0.25;
const PART_BOMB_PAYOUT = 0.5;
const PART_BIG_PAYOUT = 0.4;
const PART_BOOST = 0.5;
const PART_STORM_RECHARGE = 4; // how much faster lightning recharges during Overdrive
const PART_RALLY_BONUS = 0.5;
const PART_COMBO = 0.25;
const PART_FORGE_SECONDS = 2; // of the machine's output sent by each merge
const PART_FORGE_MIN_SOLDIERS = 5;
const PART_CLOCKWORK = 0.25; // turns per second
const FORGED_GEAR_LEVEL = 3;
// How often each rarity turns up. Beating a boss makes the good ones likelier.
const RARITY_WEIGHTS = { common: 60, rare: 30, epic: 10 };
const LUCKY_RARITY_WEIGHTS = { common: 30, rare: 45, epic: 25 };

// rarity: common unless it says otherwise. max: how many times a run can take it.
// available: only offered when it would do something in this run. oneOff: takes
// effect once, so it isn't listed among the parts the run has collected.
const REWARDS = [
  { id: "bigGear", name: "Big gear", text: "Fills half as fast, then sends 5 soldiers", gear: "big" },
  { id: "boosterGear", name: "Booster gear", text: "Gears touching it get an extra 25% per hit, and glow green", gear: "booster" },
  { id: "bombGear", name: "Bomb gear", text: "Fills half as fast, then blasts 2 enemies", gear: "bomb" },
  { id: "fasterGear", name: "Faster main gear", text: "The one-tooth gear turns 10% faster", apply: () => { driverTurnsPerSec += DRIVER_SPEED_REWARD; } },
  { id: "veterans", name: "Veterans", text: "Start every wave with more soldiers", apply: () => { waveLead += VETERANS_REWARD; }, available: () => waveLead + VETERANS_REWARD <= VETERANS_MAX_LEAD },
  { id: "reinforcements", oneOff: true, name: "Reinforcements", text: "Start the next wave with extra soldiers", apply: () => { nextWaveBonus = REINFORCEMENTS_REWARD; } },
  { id: "farGear", name: "Far gear", text: "Pays 25% more for each step away from the main gear", gear: "far" },
  { id: "loneGear", name: "Lone gear", text: "Pays 50% more for each empty space beside it", gear: "lone" },
  { id: "sparkGear", name: "Spark gear", text: "Each time it fills, your next Lightning hits 25% harder, up to 3x", gear: "spark", feature: "powerGears" },
  { id: "oilGear", name: "Oil gear", text: "Sends 1 soldier. Never rusts, and the gears touching it can't rust either", gear: "oil", feature: "powerGears" },
  { id: "iceGear", name: "Ice gear", text: "Each time it fills, the enemy grows at half speed for 2 seconds", gear: "ice", feature: "powerGears" },
  { id: "cooling", name: "Cooling oil", text: "Overdrive recharges 20% faster", max: 2 },
  { id: "staticCharge", name: "Static charge", text: "Lightning strikes hit 30% harder", max: 3 },
  { id: "scrapDealer", name: "Scrap dealer", text: "Scrapping gives 30% more soldiers", max: 1 },
  { id: "thickOil", name: "Thick oil", text: "Rust attacks hit 5% fewer of your gears", max: 2 },
  { id: "warChest", name: "War chest", text: "Earn 25% more coins from this run", max: 2 },
  { id: "drillManual", name: "Drill manual", text: "Training costs 25% less", max: 1, available: () => Boolean(nextRank()) },
  { id: "piercing", name: "Sharp spears", text: "Soldiers hit armoured brutes at full strength", max: 1, available: () => worldHasEnemy("brute") },
  { id: "antifreeze", name: "Antifreeze", text: "Freezes last half as long", max: 1, available: () => worldHasEnemy("frost") },
  { id: "fireproof", name: "Fireproof grease", text: "Fire imps burn 1 gear instead of 2", max: 1, available: () => worldHasEnemy("imp") },
  { id: "longChain", rarity: "rare", name: "Tight chain", text: "Hits fade less along a chain", max: 2 },
  { id: "bossHunter", rarity: "rare", name: "Boss hunter", text: "Everything hurts bosses 25% more", max: 2 },
  { id: "demolition", rarity: "rare", name: "Demolition", text: "Bomb gears blast 50% more enemies", max: 2, available: () => boardHasGear("bomb") },
  { id: "heavyLoad", rarity: "rare", name: "Heavy load", text: "Big gears send 40% more soldiers", max: 2, available: () => boardHasGear("big") },
  { id: "turbo", rarity: "rare", name: "Turbo booster", text: "Booster gears are 50% stronger", max: 2, available: () => boardHasGear("booster") },
  { id: "blastCleaner", rarity: "rare", name: "Blast cleaner", text: "Each bomb gear blast fixes a rusted gear", max: 1, available: () => boardHasGear("bomb") },
  { id: "stormEngine", rarity: "rare", name: "Storm engine", text: "Lightning recharges 4x faster during Overdrive", max: 1 },
  { id: "warDrums", rarity: "rare", name: "War drums", text: "A full Rally charges with 100% more, not 50%", max: 1 },
  { id: "patterns", rarity: "rare", name: "Pattern master", text: "Line and square combos are twice as strong", max: 1, available: () => grid.flat().some((cell) => cell && !cell.driver && (cell.type !== "soldier" || cell.level > 1)) },
  { id: "forgeBonus", rarity: "rare", name: "Forge bonus", text: "Every merge also sends soldiers to the battle", max: 1 },
  { id: "forgedGear", rarity: "rare", oneOff: true, name: "Forged gear", text: "A free level 3 gear", available: () => Boolean(bestEmptyCell()), apply: () => { placeGear(newGearType()).level = FORGED_GEAR_LEVEL; } },
  { id: "chargedStrike", rarity: "epic", name: "Charged strike", text: "Lightning also fills every connected gear", max: 1 },
  { id: "secondWind", rarity: "epic", name: "Second wind", text: "The next time you are overrun, the line resets instead", max: 1 },
  { id: "promotion", rarity: "epic", oneOff: true, name: "Field promotion", text: "Your army moves up a rank for free", available: () => Boolean(nextRank()), apply: () => { armyRank += 1; questEvent("rank", armyRank); } },
  { id: "clockwork", rarity: "epic", name: "Clockwork", text: "The one-tooth gear turns 25% faster", max: 2, apply: () => { driverTurnsPerSec += PART_CLOCKWORK; } },
];

const WAVE_EVENTS = [
  { id: "rush", name: "Enemy rush" },
  { id: "storm", name: "Rust storm" },
  { id: "double", name: "Double soldiers" },
  { id: "blocked", name: "Blocked row", available: () => blockableRows().length > 0 },
];

// Shown once each, the first time `when` is true. Earlier entries go first.
// Tips wait their turn so they don't pile up, unless they're urgent.
const TIPS = [
  ...WORLDS.map((world, i) => ({ id: `story:${world.id}`, urgent: true, text: WORLD_STORIES[world.id].intro, when: () => !currentEvent && !currentDaily && currentWorld === i })),
  { id: "start", urgent: true, text: "The main gear turns by itself. Each hit fills the gear beside it, and at 100% that gear sends a soldier to fight.", when: () => waveTime > 0.2 },
  { id: "boss", urgent: true, text: "Boss wave! Soldiers and bombs hurt the boss. Empty its health bar to win.", when: () => boss, card: () => bossCard() },
  // Every later boss gets its own introduction the first time it comes.
  ...[...BOSS_KINDS, ...Object.values(FINAL_BOSSES)].map((kind) => ({ id: `boss:${kind.id}`, urgent: true, text: kind.final ? "This world's last boss. Beat it to clear the world!" : "A new boss! Watch what it does, and keep Lightning ready for its glow.", when: () => Boolean(save.tips.boss) && boss?.kind.id === kind.id, card: () => bossCard() })),
  { id: "rust", urgent: true, text: "Rust! A rusted gear stops working and blocks the gears behind it. Tap it to fix it.", when: () => grid.flat().some((cell) => cell?.rusted) },
  { id: "gearDrop", urgent: true, text: "A monster dropped a gear! Drag it from the tray onto the board, next to your chain, or tap it to place it there.", target: "#gear-tray", when: () => gearTray.length > 0 },
  { id: "fusion", text: "These two gears can fuse! Drag one onto the other and look for the purple ring to make a new, stronger gear.", when: () => boardCanFuse() },
  { id: "hotStreak", urgent: true, text: "Hot streak! Win waves quickly and your main gear spins faster. A slow wave ends the streak.", when: () => hotStreak >= 2 },
  { id: "treasureGoblin", urgent: true, text: "A treasure goblin! Tap it before it escapes to grab what it's carrying.", target: "#treasure-goblin", when: () => treasureGoblin?.age > GOBLIN_TIP_AGE },
  { id: "counter", urgent: true, text: "The boss glows before it attacks. Keep Lightning ready, then press it during the glow to cancel the attack!", when: () => boss && boss.attackIn < BOSS_WARNING_SECONDS },
  { id: "short", text: "\"Need 12 more\" means your army must grow first. Training costs soldiers, and the game won't let it lose you the wave.", when: () => nextRank() && soldiersShortFor(trainCost()) > 0 && runTime > 20 },
  { id: "line", text: "Soldiers push the line. Get your side of the bar to 70% to win the wave. If it falls to 30%, you lose.", when: () => totalArmyScore >= 1 && waveTime > 5 },
  { id: "overdrive", text: "Overdrive is ready! Tap it to spin the main gear 3x faster for a few seconds, then wait for it to recharge.", target: "#overdrive-btn", when: () => overdriveReady() },
  { id: "drag", text: "Drag a gear to move it. Drag it onto the red bar that appears to scrap it and get some soldiers back.", when: () => grid.flat().filter((cell) => cell && !cell.driver).length >= 4 },
  { id: "chain", text: "Hits fade as they pass along a chain, so far-away gears fill more slowly. A booster in the chain brings them back to full strength.", when: () => grid.flat().filter((cell) => cell && !cell.driver).length >= 5 },
  { id: "combo", text: "Combos! With merged or special gears: 3 matching in a row pay 25% more, a 2x2 square fills 25% faster, and a booster with gears on all 4 sides is twice as strong.", when: () => grid.flat().some((cell) => cell && !cell.driver && (cell.level > 1 || cell.type !== "soldier")) && grid.flat().filter((cell) => cell && !cell.driver).length >= 6 },
  { id: "bossShield", urgent: true, text: "The Iron Guard raises a shield that blocks all damage. Press Break shield 5 times to break it.", when: () => boss?.shield > 0 },
  { id: "rally", text: "Rally holds your arriving soldiers back. When the button says Charge!, tap it to charge with 50% more, but your line gets no help while you wait.", target: "#rally-btn", when: () => wave >= 2 },
  { id: "train", text: "You can train your army! Every new soldier becomes stronger, and prices count in soldiers of your new rank.", target: "#train-btn", when: () => canTrain() },
  { id: "strike", text: "Press Lightning to strike the enemy! The button fills up as it recharges.", target: "#strike-btn", when: () => waveTime > 8 },
  { id: "brute", urgent: true, text: "Armoured brutes! Soldiers do less against them, but lightning and bombs hit at full strength.", when: () => enemyType?.id === "brute", card: () => enemyTypeCard("brute") },
  { id: "frost", urgent: true, text: "Frost trolls freeze your main gear to half speed. A lightning strike thaws it right away.", when: () => enemyType?.id === "frost", card: () => enemyTypeCard("frost") },
  { id: "imp", urgent: true, text: "Fire imps burn the progress out of your gears. Win fast, before they burn it all.", when: () => enemyType?.id === "imp", card: () => enemyTypeCard("imp") },
  { id: "shaman", urgent: true, text: "Rust shamans keep rusting your gears. Tap rusted gears to fix them.", when: () => enemyType?.id === "shaman", card: () => enemyTypeCard("shaman") },
  { id: "runner", urgent: true, text: "Goblin runners bring extra enemies, so win quickly.", when: () => enemyType?.id === "runner", card: () => enemyTypeCard("runner") },
  // Each tougher kind of enemy, the first wave it fights.
  ...ENEMY_RANKS.slice(1).map((rank) => ({ id: `rank:${rank.look}`, urgent: true, text: `${rank.plural} are tougher: each one counts for ${rank.strength} goblins. Train your army to keep up!`, when: () => !boss && waveTime > 0.2 && enemyRank().look === rank.look, card: () => ({ label: "New enemy!", name: rank.plural, hint: "", icon: enemyIcon(rank.look) }) })),
  { id: "spark", text: "Spark gear! Each time it fills, your next Lightning strike hits harder, up to 3x. Use Lightning to spend the charge.", when: () => grid.flat().some((cell) => cell && !cell.driver && GEAR_TYPES[cell.type].spark) },
  { id: "oil", text: "Oil gear! It never rusts, and keeps the gears touching it from rusting too. Put it among your best gears.", when: () => grid.flat().some((cell) => cell && !cell.driver && GEAR_TYPES[cell.type].oil) },
  { id: "ice", text: "Ice gear! Each time it fills, the enemy grows at half speed for a few seconds.", when: () => grid.flat().some((cell) => cell && !cell.driver && GEAR_TYPES[cell.type].chill) },
  { id: "elements", text: "Elements! Fire, ice and storm gears react when two different ones touch. Fire + ice makes steam (the enemy stops growing), fire + storm makes plasma (an extra blast), ice + storm makes a shatter (a free lightning hit).", when: () => grid.some((row, r) => row.some((cell, c) => reactionBetween(cell, grid[r][c + 1]) || reactionBetween(cell, grid[r + 1]?.[c]))) },
  { id: "superFusion", urgent: true, text: "Super fusion! Two of your fused gears can fuse again into a golden super gear. Drag one onto the other when they're the same level.", when: () => { const gears = grid.flat().filter((cell) => cell && !cell.driver && FUSIONS.some((f) => f.gear === cell.type)); return gears.some((a) => gears.some((b) => GEAR_TYPES[fusionOf(a, b)?.gear]?.super)); } },
  { id: "merge", text: "Drag a gear onto a matching one to merge them into one stronger gear. Merging also frees up space.", when: () => grid.flat().filter((cell) => cell?.type === "soldier" && cell.level === 1).length >= 3 },
];

// The enemy's own army grows on its own the whole time, scaling up per
// wave and accelerating the longer a wave drags on. The board's payout
// rate is roughly steady, so this acceleration is what guarantees every
// wave ends: take it out and the two sides can settle into a balance where
// neither threshold is ever reached.
function isBossWave(forWave) {
  return forWave % bossEvery() === 0 || isFinalWave(forWave);
}

function enemyGrowthPerSec(wave, waveTime) {
  const early = EARLY_WAVE_GROWTH[wave - 1] ?? 1;
  return early * ENEMY_BASE_GROWTH * Math.pow(ENEMY_WAVE_SCALE, wave - 1) * Math.pow(2, waveTime / ENEMY_DOUBLING_SECONDS);
}

// =====================================================================
// State
// =====================================================================

let boardCanvas, boardCtx, battleCanvas, battleCtx;
let boardCssW = 0, boardCssH = 0, cellSize = 0;
let battleCssW = 0, battleCssH = 0;

// grid[row][col] = { type, ticks, ticksAnim, spinTarget, spinAnim, flash, rusted } for a
//                  normal gear, plus { driver: true, angle, spin } for the
//                  one-tooth gear, or null for an empty cell
let grid = [];
let drag = null; // { cell, row, col, x, y } while a gear is being dragged
let peakRate = 0; // the most soldiers per second the machine has produced this run
let marchers = []; // { side: "player" | "enemy", value, t } on their way to the front
let clashes = []; // { t } sparks where soldiers reached the front
let enemyBacklog = 0; // enemy growth not yet worth a whole soldier
let driverTurnsPerSec = DRIVER_BASE_TURNS_PER_SEC;
let waveLead = WAVE_START_LEAD; // player's army vs the enemy's when a new wave begins
let rewardOpenedAt = 0;
let nextWaveBonus = 0; // extra lead for the next wave only
let tipOpenedAt = 0;
let openTip = null;
let lastTipAt = 0; // play time when the last tip appeared
let boss = null; // { kind, hp, maxHp, attackIn, hitFlash, reinforcePerSec, shield } during a boss wave
let bossesBeaten = 0;
let enemiesBlasted = 0;
let usedOverdrive = false; // this run, for the quest that forbids it
let runQuestCoins = 0;
let lastRunLevelUps = []; // { level, coins } from the run just banked
let lastRunXp = 0;
let runTime = 0; // seconds played this run, not counting reward choices
let bestWaveBeforeRun = 1; // decides whether this run set a new record
let runBanked = false; // whether this run's coins have been paid out
let runParts = {}; // reward id: times picked this run
let offeredRewards = null; // { title, ids } while a reward choice is open
let runEventWeek = 0; // the week this run's weekly challenge belongs to
let savedRun = null; // a run left unfinished last time, until it's continued or given up
let runSaveIn = RUN_SAVE_SECONDS;
let rerollsLeft = REROLLS_PER_RUN;
let pausedFromBuild = false; // resuming goes back to the break, not into a wave
let runEasy = false;
let strikeHeld = 0; // seconds lightning has been ready without being used
let buildLeft = 0; // seconds left of the break between waves
let dealAccepted = false; // the deal on offer has been taken
let activeDeal = null; // this wave's entry in WAVE_DEALS
let dealPayout = 0;
let worldLevel = 0; // index into WORLD_LEVELS for the run being chosen or played
let currentDaily = null; // { day, world, rules } during a daily challenge
let runRules = []; // ids from RULES in force this run
let runCoinScale = 1;
let runBonusCoins = 0;
let runKey = ""; // which world or challenge the run belongs to, for the play record
let wavePace = null; // this wave's entry in WAVE_PACES
let strikeCount = 0;
let rustBlocked = false; // the Guardian's block has been used this wave
let restoringBackup = false;
let nextWavePlan = null; // { boss } or { enemy, event }: the wave after this reward choice
let runStartWave = 1; // later than 1 for a head start, which earns nothing for the waves skipped
let nextRunHeadStart = false;
let lastBuzzAt = 0;
let crowdSprites = new Map();
let musicTime = 0; // when the next music step is due, on the audio clock
let musicStep = 0;
let musicGain = null;
let save = loadSave();
let currentWorld = 0; // index into WORLDS
let currentEvent = null; // this run's weekly challenge, from WEEKLY_EVENTS
let eventRustIn = 0;
let endless = false; // playing on past the final boss
let enemyType = null; // this wave's special enemy, from ENEMY_TYPES
let enemyPowerIn = 0; // seconds until its next special move
let frozenFor = 0; // seconds the main gear stays frozen
let enemyReinforcePerSec = 0;
let lastClear = null; // { coins, firstTime } for the world-clear screen
let armyRank = 0; // index into ARMY_RANKS
let rallying = false;
let rallyReserve = 0; // soldiers waiting for the charge
let rallyHeld = 0; // seconds held so far
let comboCounts = { line: 0, block: 0, ring: 0 };
let waveEvent = null; // the twist on this wave, from WAVE_EVENTS
let lastEventId = null; // so the same twist doesn't come twice in a row
let eventAttackIn = 0;
let eventReinforcePerSec = 0;
let blockedCells = new Set(); // "row,col" of empty cells no gear can use for now
let overdriveLeft = 0; // seconds of overdrive still running
let overdriveCooldown = 0; // seconds until overdrive can be used again

// Effects drawn over the whole game. They never change the outcome of a run.
let fxCanvas, fxCtx;
let fxCssW = 0, fxCssH = 0;
let boardOrigin = { x: 0, y: 0 }; // where the board canvas sits on the effects canvas
let particles = []; // { x, y, vx, vy, gravity, age, life, size, color, angle, spin }
let strikeCooldown = 0;
let bolts = []; // { x, age } lightning strikes
let fallers = []; // { x, y, vx, vy, spin, angle, age, look, facing } defeated fighters tumbling away
let lastFallerAt = 0;
let shove = { player: 0, enemy: 0 }; // how hard each front line was just hit, fading to 0
let hitStop = 0;
let winAt = 0; // when the current win happened, for the armies' reactions
let fallenBoss = null; // { boss, x, t } a beaten boss toppling over
let rewardTimer = 0;
let fightCount = null; // the numbers above the armies, as a fight; see updateFightCount()
let runLowestShare = 1; // the lowest the player's side of the bar fell this run
const COMFORTABLE_SHARE = 0.45; // a run that never fell below this was too easy
let sparkCharge = 0; // next Lightning's extra strength, from spark gears
let chillFor = 0; // seconds the enemy still grows at ICE_GROWTH
let steamFor = 0; // seconds the enemy doesn't grow at all, from steam
let hitNumbers = []; // { side, amount, color, age } at most one per side, beside the fighters
let laneRect = { x: 0, y: 0, w: 0, h: 0 }; // where the battle lane sits on the effects canvas
let screenShake = 0; // pixels
let gearTray = []; // { type, level, arriving }: dropped gears below the board, waiting to be placed
let hotStreak = 0; // fast waves in a row, up to STREAK.maxLevel
let chestPrizes = null; // ids from CHEST_PRIZES while the chests are open
let chestPicked = null; // the index chosen, or null until then
let chestTimer = null;
let chestCanvases = []; // each card's chest, redrawn every frame while the chests are open
let chestOpenAt = []; // when each lid starts to open: null while shut, 0 if it was open already
let chestFrame = null;
let lastPathWave = 0; // the wave the last route was chosen for
let offeredPaths = null; // ids from PATHS while a choice is open
let nextPath = null; // the route chosen for the next wave
let activePath = null; // this wave's route
let treasureAt = NO_GEAR_DROP; // waveTime this wave's treasure goblin appears, spent once it has
let treasureGoblin = null; // { age, seconds, sparkle } while one is running past
let gearDropAt = NO_GEAR_DROP; // waveTime this wave's free gear is due, spent once it has dropped

let gameState = "title"; // "title" | "playing" | "choosing" | "tip" | "paused" | "worldclear" | "gameover"
let wave = 1;
let waveTime = 0; // seconds since the current wave began
let playerPower = BASE_POWER;
let enemyPower = BASE_POWER;
let totalArmyScore = 0;
let bestWave = Number(localStorage.getItem("gearfight_best_wave") || 1);

// Saved data can be missing, damaged or blocked, and none of that should stop
// the game from starting.
function loadSave() {
  try {
    const data = JSON.parse(localStorage.getItem(SAVE_KEY));
    return {
      coins: Math.max(0, Math.floor(Number(data?.coins)) || 0),
      upgrades: data?.upgrades && typeof data.upgrades === "object" ? data.upgrades : {},
      muted: data?.muted === true,
      collection: data?.collection && typeof data.collection === "object" && !Array.isArray(data.collection) ? data.collection : {},
      tips: data?.tips && typeof data.tips === "object" ? data.tips : {},
      quests: Array.isArray(data?.quests) ? data.quests.filter(isValidQuest) : [],
      questsDone: Math.max(0, Math.floor(Number(data?.questsDone)) || 0),
      dailyClaimedOn: typeof data?.dailyClaimedOn === "string" ? data.dailyClaimedOn : "",
      dailyStreak: Math.max(0, Math.floor(Number(data?.dailyStreak)) || 0),
      dailyQuestsOn: typeof data?.dailyQuestsOn === "string" ? data.dailyQuestsOn : "",
      dailyQuests: Array.isArray(data?.dailyQuests) ? data.dailyQuests.filter(isValidQuest) : [],
      xp: Math.max(0, Math.floor(Number(data?.xp)) || 0),
      playerLevel: Math.max(1, Math.floor(Number(data?.playerLevel)) || 1),
      stats: data?.stats && typeof data.stats === "object" ? data.stats : {},
      worldsCleared: data?.worldsCleared && typeof data.worldsCleared === "object" ? data.worldsCleared : {},
      worldBest: data?.worldBest && typeof data.worldBest === "object" ? data.worldBest : {},
      owned: data?.owned && typeof data.owned === "object" ? data.owned : {},
      hero: typeof data?.hero === "string" ? data.hero : "knight",
      armySkin: typeof data?.armySkin === "string" ? data.armySkin : "blue",
      gearSkin: typeof data?.gearSkin === "string" ? data.gearSkin : "brass",
      eventClearedWeek: Number(data?.eventClearedWeek) || 0,
      achievements: data?.achievements && typeof data.achievements === "object" ? data.achievements : {},
      music: data?.music !== false,
      vibrate: data?.vibrate !== false,
      speed: data?.speed === 2 ? 2 : 1,
      worldLevels: data?.worldLevels && typeof data.worldLevels === "object" ? data.worldLevels : {},
      lang: typeof data?.lang === "string" ? data.lang : "",
      easy: data?.easy === true,
      bigText: data?.bigText === true,
      colorBlind: data?.colorBlind === true,
      lessMotion: typeof data?.lessMotion === "boolean" ? data.lessMotion : matchMedia("(prefers-reduced-motion: reduce)").matches,
      worldStars: data?.worldStars && typeof data.worldStars === "object" ? data.worldStars : {},
      startGear: typeof data?.startGear === "string" ? data.startGear : "none",
      heroWaves: data?.heroWaves && typeof data.heroWaves === "object" ? data.heroWaves : {},
      funnel: data?.funnel && typeof data.funnel === "object" ? data.funnel : {},
      playSeconds: Math.max(0, Number(data?.playSeconds) || 0),
      lastSeen: Number(data?.lastSeen) || 0,
      dailyChallengeDay: typeof data?.dailyChallengeDay === "string" ? data.dailyChallengeDay : "",
      dailyChallengeBest: Number(data?.dailyChallengeBest) || 0,
      dailyChallengePaid: typeof data?.dailyChallengePaid === "string" ? data.dailyChallengePaid : "",
    };
  } catch {
    return { lang: "", easy: false, bigText: false, colorBlind: false, lessMotion: false, worldStars: {}, startGear: "none", worldLevels: {}, heroWaves: {}, funnel: {}, playSeconds: 0, lastSeen: 0, dailyChallengeDay: "", dailyChallengeBest: 0, dailyChallengePaid: "", music: true, vibrate: true, speed: 1, coins: 0, upgrades: {}, muted: false, tips: {}, quests: [], questsDone: 0, dailyClaimedOn: "", dailyStreak: 0, dailyQuestsOn: "", dailyQuests: [], xp: 0, playerLevel: 1, stats: {}, worldsCleared: {}, worldBest: {}, owned: {}, hero: "knight", armySkin: "blue", gearSkin: "brass", eventClearedWeek: 0, achievements: {} };
  }
}

function isValidQuest(quest) {
  return QUEST_KINDS.some((k) => k.kind === quest?.kind) && Number(quest.target) > 0
    && Number(quest.reward) > 0 && Number.isFinite(Number(quest.progress));
}

function writeSave() {
  try {
    save.lastSeen = Date.now();
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // Without storage, progress simply lasts until the page closes.
  }
}

function questInfo(quest) {
  return QUEST_KINDS.find((k) => k.kind === quest.kind);
}

// A new quest, harder and better paid the more have been finished.
function makeQuest() {
  const taken = save.quests.map((q) => q.kind);
  const tier = Math.floor(save.questsDone / QUESTS_PER_TIER);
  const options = QUEST_KINDS.filter((k) => !taken.includes(k.kind));
  const k = options[Math.floor(Math.random() * options.length)];
  const raw = k.best ? k.base + tier * k.step : Math.round(k.base * (1 + tier * 0.5));
  return {
    kind: k.kind,
    target: k.max ? Math.min(k.max, raw) : raw,
    reward: Math.round(k.coins * (1 + tier * 0.25)),
    progress: 0,
  };
}

function fillQuests() {
  while (save.quests.length < ACTIVE_QUESTS) save.quests.push(makeQuest());
}

function statValue(stat) {
  return Number(save.stats[stat]) || 0;
}

function recordStat(stat, value = 1) {
  save.stats[stat] = BEST_STATS.includes(stat) ? Math.max(statValue(stat), value) : statValue(stat) + value;
  for (const achievement of ACHIEVEMENTS) {
    if (achievement.stat === stat && !save.achievements[achievement.id] && statValue(stat) >= achievement.target) {
      unlockAchievement(achievement);
    }
  }
}

function unlockAchievement(achievement) {
  save.achievements[achievement.id] = true;
  save.coins += achievement.coins;
  writeSave();
  announce(`Achievement: ${achievement.name}! +${achievement.coins}`);
  playClankSound();
}

function renderAchievements() {
  const unlocked = ACHIEVEMENTS.filter((a) => save.achievements[a.id]).length;
  document.getElementById("achievement-count").textContent = `${unlocked} / ${ACHIEVEMENTS.length}`;
  // Closest to done first, finished ones last.
  const ratio = (a) => (save.achievements[a.id] ? -1 : statValue(a.stat) / a.target);
  const list = document.getElementById("achievements-list");
  list.replaceChildren();
  for (const achievement of [...ACHIEVEMENTS].sort((a, b) => ratio(b) - ratio(a))) {
    const done = Boolean(save.achievements[achievement.id]);
    const row = document.createElement("div");
    row.className = done ? "quest done" : "quest";
    const name = document.createElement("b");
    name.textContent = achievement.name;
    const reward = document.createElement("em");
    reward.textContent = done ? "Done \u2713" : `${achievement.coins} coins`;
    const text = document.createElement("span");
    text.className = "achievement-text";
    text.textContent = achievement.text;
    const count = document.createElement("small");
    count.textContent = done ? "" : `${Math.min(achievement.target, Math.floor(statValue(achievement.stat)))} / ${achievement.target}`;
    row.append(name, reward, text, count);
    list.append(row);
  }
}

function xpForNextLevel(level = save.playerLevel) {
  return XP_LEVEL_BASE + (level - 1) * XP_LEVEL_STEP;
}

function playerTitle() {
  return [...PLAYER_TITLES].reverse().find((t) => save.playerLevel >= t.fromLevel).name;
}

// Adds experience, paying coins for each level gained.
function gainXp(amount) {
  const levelUps = [];
  save.xp += amount;
  while (save.xp >= xpForNextLevel()) {
    save.xp -= xpForNextLevel();
    save.playerLevel += 1;
    const coins = LEVEL_COINS_BASE + save.playerLevel * LEVEL_COINS_STEP;
    save.coins += coins;
    levelUps.push({ level: save.playerLevel, coins });
  }
  return levelUps;
}

function renderPlayerLevel() {
  document.getElementById("player-level-name").textContent = `Level ${save.playerLevel} ${playerTitle()}`;
  document.getElementById("player-level-fill").style.width = `${Math.min(100, (save.xp / xpForNextLevel()) * 100)}%`;
  document.getElementById("player-level-xp").textContent = `${save.xp} / ${xpForNextLevel()} XP`;
}

function questEvent(kind, value = 1) {
  recordStat(kind, value);
  const quest = save.quests.find((q) => q.kind === kind);
  if (quest) {
    const before = quest.progress;
    quest.progress = questInfo(quest).best ? Math.max(quest.progress, value) : quest.progress + value;
    if (quest.progress >= quest.target) completeQuest(quest);
    else if (quest.progress !== before) writeSave();
  }
  const daily = save.dailyQuests.find((q) => q.kind === kind && !q.done);
  if (daily) {
    daily.progress += value;
    if (daily.progress >= daily.target) completeDailyQuest(daily);
    else writeSave();
  }
}

// Finished daily quests stay on the list, ticked, until tomorrow's replace them.
function completeDailyQuest(quest) {
  quest.done = true;
  save.coins += quest.reward;
  runQuestCoins += quest.reward;
  writeSave();
  announce(`Daily quest done! +${quest.reward} coins`);
  playClankSound();
}

// The local calendar day, so "tomorrow" means what the player expects.
function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function refreshDailyQuests() {
  if (save.dailyQuestsOn === todayKey() && save.dailyQuests.length) return;
  const kinds = [...DAILY_QUEST_KINDS];
  save.dailyQuests = [];
  for (let i = 0; i < DAILY_QUESTS; i++) {
    const [kind] = kinds.splice(Math.floor(Math.random() * kinds.length), 1);
    const info = QUEST_KINDS.find((k) => k.kind === kind);
    save.dailyQuests.push({
      kind,
      target: Math.max(1, Math.round(info.base * DAILY_QUEST_SIZE)),
      reward: info.coins,
      progress: 0,
      done: false,
    });
  }
  save.dailyQuestsOn = todayKey();
  writeSave();
}

function dailyRewardReady() {
  return save.dailyClaimedOn !== todayKey();
}

// Which day of the weekly cycle today's reward is.
function dailyRewardIndex() {
  return save.dailyStreak % DAILY_REWARDS.length;
}

function showDailyReward() {
  if (!dailyRewardReady()) return;
  const row = document.getElementById("daily-days");
  row.replaceChildren();
  DAILY_REWARDS.forEach((coins, i) => {
    const day = document.createElement("div");
    const today = dailyRewardIndex();
    day.className = `daily-day${i === today ? " today" : i < today ? " claimed" : ""}`;
    const label = document.createElement("small");
    label.textContent = `Day ${i + 1}`;
    const value = document.createElement("b");
    value.textContent = i < today ? "\u2713" : coins;
    day.append(label, value);
    row.append(day);
  });
  document.getElementById("daily-amount").textContent = DAILY_REWARDS[dailyRewardIndex()];
  document.getElementById("daily-streak").textContent = save.dailyStreak;
  document.getElementById("daily-screen").classList.remove("hidden");
}

// A missed day doesn't reset the streak: it just carries on from where it was.
function claimDailyReward() {
  if (!dailyRewardReady()) return;
  save.coins += DAILY_REWARDS[dailyRewardIndex()];
  save.dailyStreak += 1;
  recordStat("streak", save.dailyStreak);
  save.dailyClaimedOn = todayKey();
  writeSave();
  ensureAudio();
  playClankSound();
  document.getElementById("daily-screen").classList.add("hidden");
  renderWorkshop();
}

function completeQuest(quest) {
  save.quests = save.quests.filter((q) => q !== quest);
  save.coins += quest.reward;
  save.questsDone += 1;
  recordStat("questsDone", save.questsDone);
  runQuestCoins += quest.reward;
  gainXp(XP_PER_QUEST);
  fillQuests();
  writeSave();
  announce(`Quest done! +${quest.reward} coins`);
  playClankSound();
}

function renderQuestList(listId, quests = save.quests) {
  const list = document.getElementById(listId);
  list.replaceChildren();
  for (const quest of quests) {
    const row = document.createElement("div");
    row.className = quest.done ? "quest done" : "quest";
    const name = document.createElement("b");
    name.textContent = questInfo(quest).text(quest.target);
    const reward = document.createElement("em");
    reward.textContent = quest.done ? "Done \u2713" : `${quest.reward} coins`;
    const bar = document.createElement("div");
    bar.className = "quest-bar";
    const fill = document.createElement("span");
    fill.style.width = `${Math.min(100, (quest.progress / quest.target) * 100)}%`;
    bar.append(fill);
    const count = document.createElement("small");
    count.textContent = `${Math.floor(quest.progress)} / ${quest.target}`;
    row.append(name, reward, bar, count);
    list.append(row);
  }
}

function openQuests() {
  refreshDailyQuests();
  renderQuestList("quests-list");
  renderQuestList("daily-quests-list", save.dailyQuests);
  renderAchievements();
  document.getElementById("quests-done-count").textContent = save.questsDone;
  document.getElementById("quests-screen").classList.remove("hidden");
}

function closeQuests() {
  document.getElementById("quests-screen").classList.add("hidden");
  renderWorkshop();
}

function ruleOn(id) {
  return runRules.includes(id);
}

// Daily and weekly challenges play at the normal level.
function runLevel() {
  if (runEasy) return EASY_LEVEL;
  return WORLD_LEVELS[currentDaily || currentEvent ? 0 : worldLevel];
}

// Whether a player has won enough waves to have met this feature.
function featureOn(id) {
  return statValue("waves") >= FEATURE_WAVES[id];
}

function updateFeatureButtons() {
  document.getElementById("play-hint").classList.toggle("hidden", statValue("waves") >= HINT_WAVES);
  document.getElementById("rally-btn").classList.toggle("hidden", !featureOn("rally"));
  updateTrainVisibility();
  document.getElementById("speed-btn").classList.toggle("hidden", !featureOn("speed"));
}

function announceNewFeatures() {
  for (const [id, waves] of Object.entries(FEATURE_WAVES)) {
    if (statValue("waves") === waves) announce(FEATURE_NEWS[id]);
  }
}

function levelRules(world, level) {
  return WORLD_LEVEL_RULES[WORLDS[world].id][level];
}

function rulesText(rules) {
  return rules.map((rule) => RULES[rule]).join(", ");
}

// How many waves have been won with a hero decides its level, from 1.
function heroLevel(id) {
  const waves = Number(save.heroWaves[id]) || 0;
  return HERO_LEVEL_WAVES.filter((needed) => waves >= needed).length;
}

function heroIs(id) {
  return save.hero === id;
}

function weekNumber() {
  // Weeks counted from a fixed Monday, in local time.
  const day = Math.floor((new Date().getTime() - new Date().getTimezoneOffset() * 60000) / 86400000);
  return Math.floor((day - 4) / 7);
}

function weeklyEvent() {
  return WEEKLY_EVENTS[weekNumber() % WEEKLY_EVENTS.length];
}

function worldScale() {
  if (currentDaily) return EVENT_BASE_SCALE;
  return currentEvent ? EVENT_BASE_SCALE + (currentEvent.scaleBonus || 0) : WORLDS[currentWorld].scale + runLevel().scale;
}

function finalWaveNumber() {
  return currentEvent ? EVENT_FINAL_WAVE : WORLDS[currentWorld].finalWave;
}

function bossEvery() {
  if (currentEvent?.id === "bossRush") return 3;
  return ruleOn("bossy") ? RULE_BOSS_EVERY : BOSS_EVERY_WAVES;
}

// Applies the chosen gear colour. Special gears keep theirs so they stay easy to read.
function applyGearSkin() {
  const skin = GEAR_SKINS.find((g) => g.id === save.gearSkin);
  GEAR_TYPES.soldier.palette = skin?.palette || GEAR_PALETTE;
}

// The fighter's look: its rank, in the chosen army colour and hero colours.
function fighterLook() {
  const base = ARMY_RANKS[armyRank].look;
  const key = `${base}:${save.armySkin}:${save.hero}`;
  if (!SOLDIER_LOOKS[key]) {
    const skin = ARMY_SKINS.find((a) => a.id === save.armySkin);
    const hero = HEROES.find((h) => h.id === save.hero);
    SOLDIER_LOOKS[key] = { ...SOLDIER_LOOKS[base] };
    if (skin?.tunic) Object.assign(SOLDIER_LOOKS[key], { tunic: skin.tunic, trim: skin.trim });
    if (hero?.plume) Object.assign(SOLDIER_LOOKS[key], { helmet: hero.helmet, plume: hero.plume });
  }
  return key;
}

function ownsItem(group, item) {
  return item.cost === 0 || Boolean(save.owned[`${group}:${item.id}`]);
}

function selectedItem(group) {
  return group === "hero" ? save.hero : group === "start" ? save.startGear : group === "army" ? save.armySkin : save.gearSkin;
}

function selectItem(group, item) {
  if (group === "hero") save.hero = item.id;
  else if (group === "start") save.startGear = item.id;
  else if (group === "army") save.armySkin = item.id;
  else save.gearSkin = item.id;
  applyGearSkin();
}

// Tapping an item equips it if owned, or buys it and equips it if possible.
function useItem(group, item) {
  if (!ownsItem(group, item)) {
    if (save.playerLevel < item.level || save.coins < item.cost) return;
    save.coins -= item.cost;
    save.owned[`${group}:${item.id}`] = true;
    recordStat("owned", Object.keys(save.owned).length);
    ensureAudio();
    playClankSound();
  }
  selectItem(group, item);
  writeSave();
  renderWorkshop();
}

function renderCollection() {
  const list = document.getElementById("collection-list");
  list.replaceChildren();
  for (const [group, title, items] of [["hero", "Heroes", HEROES], ["start", "Starting gear", START_GEARS], ["army", "Army colours", ARMY_SKINS], ["gear", "Gear colours", GEAR_SKINS]]) {
    const heading = document.createElement("h3");
    heading.textContent = title;
    list.append(heading);
    for (const item of items) {
      const owned = ownsItem(group, item);
      const button = document.createElement("button");
      const selected = selectedItem(group) === item.id;
      button.className = selected ? "upgrade selected" : "upgrade";
      const levelOk = save.playerLevel >= item.level;
      button.disabled = !owned && (!levelOk || save.coins < item.cost);
      const name = document.createElement("b");
      name.textContent = item.name;
      if (item.swatch) {
        const swatch = document.createElement("i");
        swatch.className = "swatch";
        swatch.style.background = item.swatch;
        name.prepend(swatch);
      }
      const text = document.createElement("span");
      text.textContent = item.text || (owned ? "Tap to use" : "A new look");
      if (group === "hero" && owned) {
        const level = heroLevel(item.id);
        const next = HERO_LEVEL_WAVES[level];
        text.textContent += `. Level ${level}${next ? ` (${Number(save.heroWaves[item.id]) || 0}/${next} waves)` : " (top)"}`;
      }
      const state = document.createElement("em");
      state.textContent = selected ? "In use" : owned ? "Use" : !levelOk ? `Level ${item.level}` : `${item.cost} coins`;
      button.append(name, text, state);
      button.addEventListener("click", () => useItem(group, item));
      list.append(button);
    }
  }
}

function upgradeLevel(id) {
  const upgrade = UPGRADES.find((u) => u.id === id);
  const level = Math.floor(Number(save.upgrades[id])) || 0;
  return Math.max(0, Math.min(upgrade.costs.length, level));
}

function freshCell(type = "soldier") {
  return { type, level: 1, ticks: 0, ticksAnim: 0, spinTarget: 0, spinAnim: 0, flash: 0 };
}

// =====================================================================
// Board logic
// =====================================================================

// Turns a cell into the one-tooth gear, starting at a random angle.
function makeDriver(row, col) {
  const cell = freshCell();
  cell.driver = true;
  cell.angle = Math.random() * Math.PI * 2;
  cell.spin = 1;
  grid[row][col] = cell;
}

function createBoard() {
  grid = [];
  for (let row = 0; row < ROWS; row++) grid.push(new Array(COLS).fill(null));
  // The one-tooth gear sits mid-board so all four sides are in reach, with
  // the one starting gear already beside it.
  makeDriver(DRIVER_ROW, DRIVER_COL);
  grid[DRIVER_ROW][DRIVER_COL + 1] = freshCell();
}

// The gear at a cell plus every gear connected to it, each spinning opposite
// to the gear that drives it, with the strength the hit still has when it gets
// there. Each gear appears once, by its shortest route, even when a loop gives
// it two. Rusted gears are stuck, so hits stop there. Empty when the
// cell has no working normal gear.
function connectedGears(row, col, firstSpin) {
  const first = grid[row]?.[col];
  if (!first || first.driver || first.rusted) return [];
  const seen = new Set([first]);
  const falloff = CHAIN_FALLOFF + partCount("longChain") * PART_CHAIN_FALLOFF;
  const queue = [{ row, col, spin: firstSpin, power: 1 }];
  for (const cur of queue) {
    for (const [dr, dc] of TOOTH_DIRS) {
      const next = grid[cur.row + dr]?.[cur.col + dc];
      if (!next || next.driver || next.rusted || seen.has(next)) continue;
      seen.add(next);
      const power = GEAR_TYPES[grid[cur.row][cur.col].type].boosts ? 1 : Math.max(CHAIN_MIN_POWER, cur.power * falloff);
      queue.push({ row: cur.row + dr, col: cur.col + dc, spin: -cur.spin, power });
    }
  }
  return queue;
}

// One tooth hit: the gear being touched turns, and turns every gear connected to it.
function tickGear(row, col, driverSpin) {
  const gears = connectedGears(row, col, -driverSpin);
  if (!gears.length) return;
  for (const gear of gears) hitGear(gear, (1 + boostersTouching(gear.row, gear.col)) * gear.power);
  spawnToothSparks(row, col);
  playTickSound();
}

// Plain level 1 gears don't count, or any big machine would be full of combos
// without trying.
function comboMatch(a, b) {
  return Boolean(a) && Boolean(b) && !a.driver && !b.driver && !a.rusted && !b.rusted
    && a.type === b.type && a.level === b.level && (a.type !== "soldier" || a.level > 1);
}

// Marks every gear with the combos it is part of, and returns how many of each.
function markCombos() {
  const at = (r, c) => grid[r]?.[c];
  const counts = { line: 0, block: 0, ring: 0 };
  for (const cell of grid.flat()) {
    if (cell) {
      cell.comboLine = false;
      cell.comboBlock = false;
      cell.comboRing = false;
    }
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = at(r, c);
      if (!cell) continue;
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const second = at(r + dr, c + dc);
        const third = at(r + dr * 2, c + dc * 2);
        if (comboMatch(cell, second) && comboMatch(cell, third)) {
          cell.comboLine = second.comboLine = third.comboLine = true;
          counts.line += 1;
        }
      }
      const right = at(r, c + 1);
      const below = at(r + 1, c);
      const corner = at(r + 1, c + 1);
      if (comboMatch(cell, right) && comboMatch(cell, below) && comboMatch(cell, corner)) {
        cell.comboBlock = right.comboBlock = below.comboBlock = corner.comboBlock = true;
        counts.block += 1;
      }
      if (GEAR_TYPES[cell.type].boosts && !cell.rusted) {
        const sides = TOOTH_DIRS.map(([dr, dc]) => at(r + dr, c + dc));
        if (sides.every((side) => side && !side.driver && !side.rusted)) {
          cell.comboRing = true;
          counts.ring += 1;
        }
      }
    }
  }
  return counts;
}

// Keeps the combo marks current and announces new ones.
function updateCombos() {
  const counts = markCombos();
  const newCombos = Math.max(0, counts.line - comboCounts.line) + Math.max(0, counts.block - comboCounts.block) + Math.max(0, counts.ring - comboCounts.ring);
  if (newCombos > 0) questEvent("combos", newCombos);
  if (counts.ring > comboCounts.ring) showToast("Ring combo!");
  else if (counts.block > comboCounts.block) showToast("Square combo!");
  else if (counts.line > comboCounts.line) showToast("Line combo!");
  comboCounts = counts;
}

function boostersTouching(row, col) {
  let count = 0;
  for (const [dr, dc] of TOOTH_DIRS) {
    const other = grid[row + dr]?.[col + dc];
    if (other && GEAR_TYPES[other.type].boosts && !other.rusted) count += other.level * (other.comboRing ? COMBO_RING_BOOST : 1);
  }
  return count * (1 + partCount("turbo") * PART_BOOST);
}

// For text that's set every frame: only touches the page when it really changes.
function setLabel(el, text) {
  const value = t(text);
  if (el.textContent !== value) el.textContent = value;
}

function partCount(id) {
  return runParts[id] || 0;
}

function worldHasEnemy(id) {
  return WORLDS[currentEvent ? 0 : currentWorld].enemies.some(([enemy]) => enemy === id);
}

// Far and Lone gears pay for where they are, so placing them is a real choice.
function gearPlacePayout(row, col) {
  const cell = grid[row][col];
  if (GEAR_TYPES[cell.type].far) {
    const steps = Math.abs(row - DRIVER_ROW) + Math.abs(col - DRIVER_COL);
    return 1 + Math.max(0, steps - 1) * FAR_PAYOUT_PER_STEP;
  }
  if (GEAR_TYPES[cell.type].lone) {
    const empty = TOOTH_DIRS.filter(([dr, dc]) => {
      const r = row + dr;
      const c = col + dc;
      return r >= 0 && r < ROWS && c >= 0 && c < COLS && !grid[r][c];
    }).length;
    return 1 + empty * LONE_PAYOUT_PER_SIDE;
  }
  return 1;
}

function comboLinePayout() {
  return COMBO_LINE_PAYOUT + partCount("patterns") * PART_COMBO;
}

function comboBlockFill() {
  return COMBO_BLOCK_FILL + partCount("patterns") * PART_COMBO;
}

// What this run's rewards add to one kind of gear's payout.
function gearPartPayout(type) {
  const spec = GEAR_TYPES[type];
  return (spec.heavy ? 1 + partCount("heavyLoad") * PART_BIG_PAYOUT : 1) * (spec.blast ? 1 + partCount("demolition") * PART_BOMB_PAYOUT : 1);
}

// Each turn the tooth hits all four sides once, so a gear reachable from two
// sides fills twice as fast. Blasting an enemy counts as the soldiers it would
// take to match it, since either one moves the line toward a win.
function soldiersPerSecond() {
  const soldiersPerEnemy = WIN_RATIO / (1 - WIN_RATIO);
  let perTurn = 0;
  for (const [dr, dc] of TOOTH_DIRS) {
    for (const gear of connectedGears(DRIVER_ROW + dr, DRIVER_COL + dc, 1)) {
      const spec = GEAR_TYPES[grid[gear.row][gear.col].type];
      if (!spec.hits) continue;
      const level = levelPayout(grid[gear.row][gear.col].level) * armyStrength();
      const cell = grid[gear.row][gear.col];
      const payout = ((spec.soldiers || 0) + (spec.enemies || 0) * soldiersPerEnemy) * level * gearPartPayout(cell.type) * gearPlacePayout(gear.row, gear.col) * (cell.comboLine ? comboLinePayout() : 1);
      const fill = cell.comboBlock ? comboBlockFill() : 1;
      perTurn += ((1 + boostersTouching(gear.row, gear.col)) * gear.power * fill * payout) / spec.hits;
    }
  }
  return perTurn * driverTurnsPerSec;
}

function reactionBetween(a, b) {
  const one = a && !a.driver && !a.rusted && GEAR_TYPES[a.type].element;
  const two = b && !b.driver && !b.rusted && GEAR_TYPES[b.type].element;
  if (!one || !two || one === two) return null;
  return REACTIONS[[one, two].sort().join("+")];
}

// The gear at row, col just filled: it reacts with each neighbour of another element.
function react(row, col) {
  const cell = grid[row][col];
  if (runTime - (cell.reactedAt ?? -Infinity) < REACTION_GAP_SECONDS) return;
  for (const [dr, dc] of TOOTH_DIRS) {
    const other = grid[row + dr]?.[col + dc];
    const reaction = reactionBetween(cell, other);
    if (!reaction) continue;
    cell.reactedAt = runTime;
    const level = Math.min(cell.level, other.level);
    if (reaction.id === "steam") steamFor = Math.max(steamFor, STEAM_SECONDS);
    else if (reaction.id === "plasma") launchBomb(PLASMA_ENEMIES * levelPayout(level) * armyStrength());
    else if (reaction.id === "shatter") shatterHit(level);
    recordStat("reactions");
    showReaction(reaction, row, col, row + dr, col + dc);
  }
}

// A free lightning hit, without using Lightning.
function shatterHit(level) {
  const amount = Math.max(armyStrength(), soldiersPerSecond() * SHATTER_SECONDS) * levelPayout(level);
  enemyPower = Math.max(1, enemyPower - amount * (1 - WIN_RATIO) / WIN_RATIO);
  damageBoss(amount);
  shove.enemy = 1;
  spawnFaller("enemy");
}

let lastReactionToastAt = {};
function showReaction(reaction, r1, c1, r2, c2) {
  const a = cellCenter(r1, c1);
  const b = cellCenter(r2, c2);
  const x = (a.x + b.x) / 2;
  const y = (a.y + b.y) / 2;
  for (let i = 0; i < 12; i++) {
    const angle = randomBetween(0, Math.PI * 2);
    const speed = randomBetween(40, 150);
    spawnParticle({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 30, gravity: 120, life: randomBetween(0.3, 0.6), size: randomBetween(2, 4), color: reaction.colors[i % 2] });
  }
  // Named now and then, not on every reaction.
  const now = performance.now();
  if (now - (lastReactionToastAt[reaction.id] ?? 0) > 4000) {
    lastReactionToastAt[reaction.id] = now;
    showToast(`${reaction.icon} ${reaction.name}!`);
    playChestRattleSound(2);
  }
}

// A full gear pays out and starts filling again, staying in place.
function hitGear(gear, hits) {
  const cell = grid[gear.row][gear.col];
  const spec = GEAR_TYPES[cell.type];
  cell.spinTarget += gear.spin;
  cell.flash = 1;
  if (!spec.hits) return;
  cell.ticks += hits * (cell.comboBlock ? comboBlockFill() : 1);
  while (cell.ticks >= spec.hits) {
    cell.ticks -= spec.hits;
    cell.ticksAnim = cell.ticks;
    const level = levelPayout(cell.level) * gearPartPayout(cell.type) * gearPlacePayout(gear.row, gear.col) * (cell.comboLine ? comboLinePayout() : 1) * armyStrength();
    if (spec.soldiers) sendSoldiers(spec.soldiers * level);
    if (spec.enemies) launchBomb(spec.enemies * level);
    if (spec.spark) sparkCharge = Math.min(SPARK_MAX, sparkCharge + SPARK_CHARGE * cell.level);
    if (spec.chill) chillFor = Math.max(chillFor, ICE_SECONDS + cell.level - 1);
    if (spec.element) react(gear.row, gear.col);
  }
}

function armyStrength() {
  return ARMY_RANKS[armyRank].strength;
}

function enemyRank() {
  return [...ENEMY_RANKS].reverse().find((rank) => wave >= rank.fromWave);
}

function trainCost() {
  const manual = partCount("drillManual") ? PART_TRAIN_COST : 1;
  return Math.round(nextRank().trainCost * (1 - upgradeLevel("drillSergeant") * TRAIN_DISCOUNT_PER_LEVEL) * manual);
}

function nextRank() {
  return ARMY_RANKS[armyRank + 1];
}

function canTrain() {
  return gameState === "playing" && Boolean(nextRank()) && soldiersShortFor(trainCost()) === 0;
}

// A rank-up is a transformation: light comes down on the front fighter, a
// flash, and the new character pops out. See drawRankUp().
const RANK_UP_SECONDS = 1.4;
const RANK_UP_REVEAL = 0.35; // share of the way through when the new character appears
let rankUp = null; // { t, fromLook, x, y, burst } while the transformation plays

function trainArmy() {
  if (!canTrain()) return;
  const fromLook = fighterLook();
  playerPower -= trainCost() * armyStrength();
  armyRank += 1;
  questEvent("rank", armyRank);
  buzz(30);
  showWaveBanner(`${ARMY_RANKS[armyRank].plural}!`, false, true);
  if (!save.lessMotion && !REDUCED_MOTION) rankUp = { t: 0, fromLook, x: 0, y: 0, burst: false };
  else spawnConfetti();
  playRankUpSound();
}

function updateRankUp(dt) {
  if (!rankUp) return;
  rankUp.t += dt / RANK_UP_SECONDS;
  if (!rankUp.burst && rankUp.t >= RANK_UP_REVEAL) {
    rankUp.burst = true;
    buzz(60);
    spawnConfetti();
    for (let i = 0; i < 24; i++) {
      const angle = randomBetween(0, Math.PI * 2);
      const speed = randomBetween(60, 220);
      spawnParticle({
        x: rankUp.x,
        y: rankUp.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        gravity: 260,
        life: randomBetween(0.5, 0.9),
        size: randomBetween(2.5, 5),
        color: i % 3 ? "#ffe14d" : "#ffffff",
      });
    }
  }
  if (rankUp.t >= 1) rankUp = null;
}

function drawRankUp(ctx, x, groundY, newLook) {
  const t = rankUp.t;
  rankUp.x = laneRect.x + x;
  rankUp.y = laneRect.y + groundY - 22;
  // A beam of light from the sky.
  const beam = t < 0.7 ? Math.min(1, t / 0.2) : Math.max(0, 1 - (t - 0.7) / 0.3);
  const light = ctx.createLinearGradient(0, 0, 0, groundY);
  light.addColorStop(0, "rgba(255, 240, 160, 0)");
  light.addColorStop(1, `rgba(255, 240, 160, ${0.75 * beam})`);
  ctx.fillStyle = light;
  ctx.fillRect(x - 15, 0, 30, groundY);
  if (t < RANK_UP_REVEAL) {
    // The old fighter shakes and glows white.
    const k = t / RANK_UP_REVEAL;
    ctx.save();
    ctx.translate(Math.sin(t * 140) * k * 1.6, 0);
    drawArmyFighter(ctx, x, groundY, rankUp.fromLook, 1, "idle", "happy");
    ctx.restore();
    ctx.beginPath();
    ctx.ellipse(x, groundY - 20, 13, 22, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${k * 0.7})`;
    ctx.fill();
  } else {
    // The new one pops out big, then settles.
    const k = (t - RANK_UP_REVEAL) / (1 - RANK_UP_REVEAL);
    const pop = k < 0.3 ? 0.4 + (k / 0.3) * 0.85 : k < 0.6 ? 1.25 - ((k - 0.3) / 0.3) * 0.25 : 1;
    ctx.save();
    ctx.translate(x, groundY);
    ctx.scale(pop, pop);
    ctx.translate(-x, -groundY);
    drawArmyFighter(ctx, x, groundY, newLook, 1, "cheer", "happy");
    ctx.restore();
    for (const delay of [0, 0.18]) {
      const rk = k - delay;
      if (rk <= 0 || rk >= 0.6) continue;
      const r = 8 + rk * 70;
      ctx.beginPath();
      ctx.ellipse(x, groundY - 1, r, r * 0.28, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 210, 63, ${1 - rk / 0.6})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }
  // The flash at the moment of change.
  const flash = 1 - Math.abs(t - RANK_UP_REVEAL) / 0.1;
  if (flash > 0) {
    const glow = ctx.createRadialGradient(x, groundY - 22, 2, x, groundY - 22, 34);
    glow.addColorStop(0, `rgba(255, 255, 255, ${flash})`);
    glow.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x - 34, groundY - 56, 68, 68);
  }
}

// Train only takes up room while there is a rank left to train to.
function updateTrainVisibility() {
  document.getElementById("train-btn").classList.toggle("hidden", !featureOn("train") || !nextRank());
}

function updateTrainButton() {
  updateTrainVisibility();
  const button = document.getElementById("train-btn");
  const next = nextRank();
  let label = `${ARMY_RANKS[armyRank].plural} (top rank)`;
  let charge = 1;
  if (next) {
    // The button fills as the army grows toward the cost of the next rank.
    const short = soldiersShortFor(trainCost());
    charge = Math.max(0, 1 - short / trainCost());
    label = short > 0 ? `Train ${next.name}` : `Train ${next.name}!`;
  }
  setLabel(button, label);
  button.style.setProperty("--charge", `${Math.round(charge * 100)}%`);
  button.disabled = !canTrain();
  setLabel(document.getElementById("rank-label"), ARMY_RANKS[armyRank].plural);
}

function levelPayout(level) {
  return Math.round(Math.pow(LEVEL_PAYOUT_GROWTH, level - 1));
}

function canMerge(from, onto) {
  return Boolean(onto) && !onto.driver && from !== onto && from.type === onto.type
    && from.level === onto.level && from.level < MAX_GEAR_LEVEL;
}

// The gear on the target cell levels up and keeps its progress.
function mergeGears(fromRow, fromCol, toRow, toCol) {
  grid[fromRow][fromCol] = null;
  levelUpGear(toRow, toCol);
}

function boardCanFuse() {
  const gears = grid.flat().filter((cell) => cell && !cell.driver);
  return gears.some((a) => gears.some((b) => canFuse(a, b)));
}

function fusionOf(from, onto) {
  if (!from || !onto || onto.driver || from.driver || from === onto || from.level !== onto.level) return null;
  return FUSIONS.find((fusion) => fusion.parts.includes(from.type) && fusion.parts.includes(onto.type) && from.type !== onto.type) || null;
}

function canFuse(from, onto) {
  return Boolean(fusionOf(from, onto));
}

// The target cell takes the new gear, so the player chooses where it ends up.
function fuseOnto(from, toRow, toCol) {
  const onto = grid[toRow][toCol];
  const fusion = fusionOf(from, onto);
  grid[toRow][toCol] = freshCell(fusion.gear);
  grid[toRow][toCol].level = onto.level;
  grid[toRow][toCol].flash = 1;
  discover(`gear:${fusion.gear}`);
  recordStat("fusions");
  spawnRustBurst(toRow, toCol, "#d08cff", "#f3e0ff");
  if (GEAR_TYPES[fusion.gear].super) {
    showWaveBanner(`${fusion.name}!`, false, true);
    spawnConfetti();
    playRankUpSound();
  } else showToast(`Fusion: ${fusion.name}!`);
  playOverdriveSound();
  buzz(60);
}

function levelUpGear(toRow, toCol) {
  const target = grid[toRow][toCol];
  target.level += 1;
  target.rusted = false;
  questEvent("merges");
  questEvent("topLevel", target.level);
  target.flash = 1;
  spawnRustBurst(toRow, toCol, "#ffcc33", "#fff3c4");
  showToast(`Level ${target.level}!`);
  playClankSound();
  if (partCount("forgeBonus")) sendSoldiers(Math.max(PART_FORGE_MIN_SOLDIERS * armyStrength(), soldiersPerSecond() * PART_FORGE_SECONDS));
}

// Where a new gear goes: the free cell closest to the one-tooth gear along the
// chain, so it starts working at once. Any free cell will do if the chain is
// walled in, and null means the board is full.
function bestEmptyCell() {
  const seen = new Set([grid[DRIVER_ROW][DRIVER_COL]]);
  const queue = [{ row: DRIVER_ROW, col: DRIVER_COL }];
  for (const { row, col } of queue) {
    for (const [dr, dc] of TOOTH_DIRS) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
      const cell = grid[r][c];
      if (!cell) {
        if (!isBlocked(r, c)) return { row: r, col: c };
        continue;
      }
      if (!seen.has(cell)) {
        seen.add(cell);
        queue.push({ row: r, col: c });
      }
    }
  }
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (!grid[row][col] && !isBlocked(row, col)) return { row, col };
    }
  }
  return null;
}

function isBlocked(row, col) {
  return blockedCells.has(`${row},${col}`);
}

function newGearType() {
  return currentEvent?.id === "bombs" ? "bomb" : "soldier";
}

function placeGear(type) {
  discover(`gear:${type}`);
  const { row, col } = bestEmptyCell();
  grid[row][col] = freshCell(type);
  grid[row][col].flash = 1;
  return grid[row][col];
}

// Soldiers are the price, so training weakens the army. It must leave a real
// margin above the line: stopping just short of it lost the run a moment later,
// right after a button that looked ready. Returns how many more soldiers the player
// needs for this one, or 0 when they can afford it.
function soldiersShortFor(soldiers) {
  const armyToKeep = (enemyPower * TRAIN_KEEP_SHARE) / (1 - TRAIN_KEEP_SHARE);
  const short = soldiers * armyStrength() + armyToKeep - playerPower;
  return short < 0 ? 0 : Math.floor(short / armyStrength()) + 1;
}

// Worth more with a bigger machine, so scrapping stays useful later in a run.
function scrapRefund() {
  const gears = grid.flat().filter((cell) => cell && !cell.driver).length;
  const worth = GEAR_BASE_COST * Math.pow(GEAR_COST_GROWTH, gears);
  return Math.floor(worth * (partCount("scrapDealer") ? PART_SCRAP_REFUND : 0.5));
}

function scrapGear(row, col) {
  recordStat("scraps");
  const refund = scrapRefund();
  grid[row][col] = null;
  playerPower += refund * armyStrength();
  spawnRustBurst(row, col);
  showToast(`Scrapped: +${refund}`);
  playClankSound();
}

function pointerOverScrapZone(e) {
  const r = document.getElementById("scrap-zone").getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

function updateScrapZone() {
  const zone = document.getElementById("scrap-zone");
  // Scrapping pays in soldiers, which are worth nothing during the break.
  const showing = Boolean(drag) && drag.tray === undefined && gameState === "playing";
  zone.classList.toggle("hidden", !showing);
  if (!showing) return;
  zone.classList.toggle("hover", Boolean(drag.overScrap));
  const label = `Drop here to scrap: +${scrapRefund()}`;
  setLabel(zone, label);
}

function sendSoldiers(baseCount) {
  const berserk = heroIs("berserker") && overdriveLeft > 0 ? BERSERKER_OVERDRIVE_SOLDIERS : 1;
  const count = baseCount * berserk * (waveEvent?.id === "double" ? 2 : 1);
  sendMarcher("player", count, MARCH_ARRIVED);
  totalArmyScore += count / armyStrength();
  playFireSound();
}

function launchBomb(enemies) {
  enemiesBlasted += enemies;
  questEvent("blasted", enemies);
  sendMarcher("bomb", enemies, MARCH_ARRIVED);
  if (partCount("blastCleaner")) fixOneRustedGear();
  playFireSound();
}

function fixOneRustedGear() {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (!grid[row][col]?.rusted) continue;
      grid[row][col].rusted = false;
      recordStat("rustFixed");
      spawnRustBurst(row, col, "#ffcc33", "#fff3c4");
      return;
    }
  }
}

// The player's soldiers and bombs land at once; the enemy's march in from the start.
function sendMarcher(side, value, t = 0) {
  const team = marchers.filter((m) => m.side === side);
  if (team.length >= MAX_MARCHERS) team[team.length - 1].value += value;
  else marchers.push({ side, value, t });
}

function isFinalWave(forWave) {
  return !endless && forWave === finalWaveNumber();
}

function bossWeakening() {
  return (1 - upgradeLevel("bossBreaker") * BOSS_BREAKER_PER_LEVEL) * (heroIs("guardian") ? GUARDIAN_BOSS : 1) * (runEasy ? EASY_BOSS : 1);
}

function bossMaxHp(forWave) {
  const soldiersToWinPerEnemy = WIN_RATIO / (1 - WIN_RATIO) - waveLead;
  const finalScale = isFinalWave(forWave) ? (currentEvent ? FINAL_BOSS_HP : WORLDS[currentWorld].finalHp) : 1;
  return waveStartEnemy(forWave) * soldiersToWinPerEnemy * BOSS_HP_SCALE * bossWeakening() * finalScale * runLevel().bossHp;
}

function damageBoss(amount) {
  if (!boss || boss.shield > 0) return;
  boss.hp = Math.max(0, boss.hp - amount * (1 + partCount("bossHunter") * PART_BOSS_DAMAGE));
  boss.hitFlash = 1;
}

function bossReinforcePerSec(enemyStart) {
  return enemyStart * BOSS_PRESSURE * bossWeakening();
}

function rustShare() {
  return Math.max(MIN_RUST_SHARE, BOSS_RUST_SHARE - upgradeLevel("rustGuard") * RUST_GUARD_PER_LEVEL - partCount("thickOil") * PART_RUST_SHARE);
}

function rustPerAttack(workingGears) {
  return Math.min(BOSS_RUST_MAX_PER_ATTACK, Math.ceil(workingGears * rustShare()));
}

// Every working gear the tooth can reach, so an attack always hurts the machine.
function rustTargets() {
  const targets = new Map();
  for (const [dr, dc] of TOOTH_DIRS) {
    for (const gear of connectedGears(DRIVER_ROW + dr, DRIVER_COL + dc, 1)) {
      targets.set(grid[gear.row][gear.col], gear);
    }
  }
  return [...targets.values()];
}

// An oil gear can't rust, and keeps the gears touching it from rusting.
function rustProof(row, col) {
  const oily = (cell) => cell && !cell.driver && !cell.rusted && GEAR_TYPES[cell.type].oil;
  return oily(grid[row][col]) || TOOTH_DIRS.some(([dr, dc]) => oily(grid[row + dr]?.[col + dc]));
}

function rustAttack() {
  if (heroIs("guardian") && !rustBlocked) {
    rustBlocked = true;
    showToast("Rust blocked!");
    playClankSound();
    return;
  }
  const targets = rustTargets().filter((gear) => !rustProof(gear.row, gear.col));
  if (!targets.length) return;
  const count = rustPerAttack(targets.length);
  for (let i = 0; i < count; i++) {
    const [{ row, col }] = targets.splice(Math.floor(Math.random() * targets.length), 1);
    grid[row][col].rusted = true;
    if (drag?.cell === grid[row][col]) drag = null;
    spawnRustBurst(row, col);
  }
  screenShake = Math.max(screenShake, BOMB_SHAKE);
  buzz(40);
  showToast("Rust! Tap the gears");
  playRustSound();
}

function wallAttack() {
  const free = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (!grid[row][col] && !isBlocked(row, col)) free.push({ row, col });
    }
  }
  if (!free.length) {
    rustAttack();
    return;
  }
  for (let i = 0; i < BOSS_WALL_CELLS && free.length; i++) {
    const [{ row, col }] = free.splice(Math.floor(Math.random() * free.length), 1);
    blockedCells.add(`${row},${col}`);
  }
  screenShake = Math.max(screenShake, BOMB_SHAKE);
  showToast("Cells blocked!");
  playRustSound();
}

// Gears only swap with each other, so the machine keeps its shape and stays
// connected: moving them onto empty cells could cut off most of the machine
// faster than anyone could drag it back.
function scrambleAttack() {
  const gears = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (grid[row][col] && !grid[row][col].driver) gears.push({ row, col });
    }
  }
  if (gears.length < 2) return;
  for (let i = 0; i < BOSS_SCRAMBLE_SWAPS; i++) {
    const a = gears[Math.floor(Math.random() * gears.length)];
    const b = gears[Math.floor(Math.random() * gears.length)];
    [grid[a.row][a.col], grid[b.row][b.col]] = [grid[b.row][b.col], grid[a.row][a.col]];
    spawnRustBurst(a.row, a.col, "#8fe7ff", "#1d6e6a");
    spawnRustBurst(b.row, b.col, "#8fe7ff", "#1d6e6a");
  }
  drag = null;
  screenShake = Math.max(screenShake, BOMB_SHAKE);
  showToast("Scrambled!");
  playRustSound();
}

function shieldAttack() {
  if (boss.shield > 0) return;
  boss.shield = BOSS_SHIELD_TAPS;
  showToast("Shield up! Press Break shield");
  playRustSound();
}

function warlordAttack() {
  enemyPower *= 1 + WARLORD_REINFORCE_SHARE;
  screenShake = Math.max(screenShake, BOMB_SHAKE);
  showToast("Reinforcements!");
  playRustSound();
}

function wyrmAttack() {
  for (const cell of grid.flat()) {
    if (cell && !cell.driver) cell.ticks *= WYRM_DRAIN;
  }
  screenShake = Math.max(screenShake, BOMB_SHAKE);
  showToast("Sandstorm! Progress lost");
  playRustSound();
}

function queenAttack() {
  frozenFor = QUEEN_FREEZE_SECONDS / (1 + partCount("antifreeze"));
  screenShake = Math.max(screenShake, BOMB_SHAKE);
  showToast("Frozen! Use Lightning to thaw");
  playRustSound();
}

// Melts the weakest gear, but never takes a small machine apart.
function magmaAttack() {
  const gears = [];
  grid.forEach((row, r) => row.forEach((cell, c) => {
    if (cell && !cell.driver) gears.push({ r, c, level: cell.level });
  }));
  if (gears.length <= MAGMA_MIN_GEARS) {
    burnGears();
    return;
  }
  const { r, c } = gears.reduce((weakest, gear) => (gear.level < weakest.level ? gear : weakest));
  if (drag?.cell === grid[r][c]) drag = null;
  grid[r][c] = null;
  spawnRustBurst(r, c, "#ff8a3d", "#ffcc33");
  screenShake = Math.max(screenShake, BOMB_SHAKE);
  showToast("A gear melted!");
  playRustSound();
}

function bossKind(id) {
  return BOSS_KINDS.find((kind) => kind.id === id) || Object.values(FINAL_BOSSES).find((kind) => kind.id === id);
}

function bossAttack() {
  if (boss.kind.id === "wall") wallAttack();
  else if (boss.kind.id === "scramble") scrambleAttack();
  else if (boss.kind.id === "shield") shieldAttack();
  else if (boss.kind.id === "warlord") warlordAttack();
  else if (boss.kind.id === "wyrm") wyrmAttack();
  else if (boss.kind.id === "queen") queenAttack();
  else if (boss.kind.id === "magma") magmaAttack();
  else rustAttack();
}

// A raised shield takes presses first, otherwise the button calls a strike.
function pressLightning() {
  ensureAudio();
  if (boss?.shield > 0) tapShield();
  else strikeEnemy();
}

function updateStrikeButton() {
  const button = document.getElementById("strike-btn");
  const shielded = boss?.shield > 0;
  const blocked = Boolean(activeDeal?.noStrike);
  const ready = strikeCooldown <= 0;
  const canCounter = boss && ready && !shielded && boss.attackIn < BOSS_WARNING_SECONDS && strikeHeld >= COUNTER_HOLD_SECONDS;
  let label = "Lightning!";
  if (shielded) label = `Break shield: ${boss.shield}`;
  else if (blocked) label = "No lightning";
  else if (canCounter) label = "Strike now!";
  else if (!ready) label = "Lightning"; // the ring around the button shows the recharge
  setLabel(button, label);
  button.disabled = gameState !== "playing" || (!shielded && (blocked || !ready));
  button.classList.toggle("ready", !shielded && !blocked && ready);
  button.classList.toggle("shield", Boolean(shielded));
  button.classList.toggle("counter", Boolean(canCounter));
  const charge = shielded || blocked ? 0 : 1 - Math.min(1, strikeCooldown / strikeRecharge());
  button.style.setProperty("--charge", `${Math.round(charge * 100)}%`);
}

function strikeRecharge() {
  const seconds = STRIKE_COOLDOWN_SECONDS - upgradeLevel("strikeRecharge") * STRIKE_RECHARGE_PER_LEVEL - (heroIs("archer") ? ARCHER_RECHARGE : 0);
  return overdriveLeft > 0 && partCount("stormEngine") ? seconds / PART_STORM_RECHARGE : seconds;
}

function strikeEnemy() {
  if (gameState !== "playing" || strikeCooldown > 0) return;
  if (activeDeal?.noStrike) return;
  const countered = boss && boss.attackIn < BOSS_WARNING_SECONDS && strikeHeld >= COUNTER_HOLD_SECONDS;
  strikeHeld = 0;
  if (countered) {
    boss.attackIn = BOSS_ATTACK_SECONDS;
    recordStat("counters");
    showWaveBanner("Countered!");
    spawnConfetti();
    buzz(50);
  }
  strikeCooldown = strikeRecharge();
  questEvent("strikes");
  buzz(15);
  frozenFor = 0;
  strikeCount += 1;
  const triple = heroIs("archer") && strikeCount % ARCHER_TRIPLE_EVERY === 0 ? 3 : 1;
  const boost = triple * (1 + upgradeLevel("strikePower") * STRIKE_POWER_PER_LEVEL) * (heroIs("archer") ? ARCHER_STRIKE : 1) * (1 + partCount("staticCharge") * PART_STRIKE);
  const amount = Math.max(armyStrength(), soldiersPerSecond() * STRIKE_OUTPUT_SECONDS) * boost * (1 + sparkCharge);
  sparkCharge = 0;
  enemyPower = Math.max(1, enemyPower - amount * (1 - WIN_RATIO) / WIN_RATIO);
  damageBoss(amount);
  if (partCount("chargedStrike")) {
    for (const gear of rustTargets()) hitGear(gear, 1);
  }
  const front = frontLineFx();
  const x = front.x + 22;
  bolts.push({ x, age: 0 });
  shove.enemy = 1;
  hitStop = HIT_STOP_SECONDS;
  screenShake = Math.max(screenShake, 3);
  spawnFaller("enemy");
  for (let i = 0; i < 10; i++) {
    spawnParticle({
      x,
      y: front.y + 8,
      vx: randomBetween(-110, 110),
      vy: randomBetween(-140, 0),
      gravity: 300,
      life: randomBetween(0.2, 0.45),
      size: randomBetween(2, 3.5),
      color: i % 2 ? "#ffe14d" : "#ffffff",
    });
  }
  playStrikeSound();
}

function tapShield() {
  if (gameState !== "playing" || !(boss?.shield > 0)) return;
  boss.shield -= 1;
  boss.hitFlash = 1;
  playClankSound();
  if (boss.shield === 0) showToast("Shield broken!");
}

function blockableRows() {
  const rows = [];
  for (let row = 0; row < ROWS; row++) {
    if (row !== DRIVER_ROW && grid[row].some((cell) => !cell)) rows.push(row);
  }
  return rows;
}

// Chosen when the reward screen opens, so that it can say what's coming.
function planWave(forWave) {
  const random = runRandom(`wave${forWave}`);
  if (isFinalWave(forWave) && !currentEvent) return { boss: FINAL_BOSSES[WORLDS[currentWorld].id].id };
  if (isBossWave(forWave)) {
    // Each world's bosses begin at a different kind, so worlds don't repeat.
    return { boss: BOSS_KINDS[(Math.round(forWave / bossEvery()) - 1 + currentWorld) % BOSS_KINDS.length].id };
  }
  const options = WORLDS[currentEvent ? 0 : currentWorld].enemies.filter(([, fromWave]) => forWave >= fromWave);
  const [enemy] = options[Math.floor(random() * options.length)];
  // Plain goblins leave the wave free for a wave event. Any other wave can change pace.
  if (enemy === "goblin" && forWave >= WAVE_EVENT_FIRST_WAVE && random() < WAVE_EVENT_CHANCE) {
    const events = WAVE_EVENTS.filter((e) => e.id !== lastEventId && (!e.available || e.available()));
    const event = events[Math.floor(random() * events.length)];
    if (event) {
      lastEventId = event.id;
      return { enemy, event: event.id, pace: null };
    }
  }
  const pace = forWave >= PACE_FIRST_WAVE && random() < PACE_CHANCE ? (random() < 0.5 ? "rush" : "siege") : null;
  const deals = Object.keys(WAVE_DEALS);
  const deal = forWave >= DEAL_FIRST_WAVE && random() < DEAL_CHANCE && featureOn("deal") ? deals[Math.floor(random() * deals.length)] : null;
  return { enemy, event: null, pace, deal };
}

function nextWaveText(plan) {
  if (plan.boss) {
    const kind = bossKind(plan.boss);
    return `Next: ${isFinalWave(wave) ? "Final boss, " : ""}${kind.name} (${NEXT_WAVE_HINTS[kind.id]})`;
  }
  if (plan.event) {
    return `Next: ${WAVE_EVENTS.find((e) => e.id === plan.event).name} (${NEXT_WAVE_HINTS[plan.event]})`;
  }
  if (plan.pace) {
    const who = plan.enemy !== "goblin" ? `, ${ENEMY_TYPES[plan.enemy].name}` : "";
    return `Next: ${WAVE_PACES[plan.pace].name}${who} (${NEXT_WAVE_HINTS[plan.pace === "rush" ? "paceRush" : "paceSiege"]})`;
  }
  if (plan.enemy !== "goblin") return `Next: ${ENEMY_TYPES[plan.enemy].name} (${NEXT_WAVE_HINTS[plan.enemy]})`;
  return `Next: ${enemyRank().plural}`;
}

function startWaveEvent(id) {
  const planned = WAVE_EVENTS.find((e) => e.id === id);
  // The board can change between planning and starting.
  if (!planned || (planned.available && !planned.available())) return;
  waveEvent = planned;
  eventAttackIn = EVENT_STORM_SECONDS;
  // Tied to the machine's output: each enemy takes about 2.3 soldiers to match
  // at WIN_RATIO, so this share slows a win down without making it impossible.
  eventReinforcePerSec = waveEvent.id === "rush" ? peakRate * EVENT_RUSH_SHARE : 0;
  if (waveEvent.id === "blocked") {
    const rows = blockableRows();
    const row = rows[Math.floor(Math.random() * rows.length)];
    for (let col = 0; col < COLS; col++) {
      if (!grid[row][col]) blockedCells.add(`${row},${col}`);
    }
  }
}

function updateWaveEvent(dt) {
  if (waveEvent?.id !== "storm") return;
  eventAttackIn -= dt;
  if (eventAttackIn <= 0) {
    eventAttackIn = EVENT_STORM_SECONDS;
    rustAttack();
  }
}

function updateBoss(dt) {
  if (!boss) return;
  // The boss drops in from the sky and lands with a crash.
  if ((boss.enter ?? 1) < 1) {
    boss.enter = Math.min(1, boss.enter + dt / BOSS_DROP_SECONDS);
    if (boss.enter >= 1) {
      screenShake = Math.max(screenShake, BOSS_LAND_SHAKE);
      buzz(120);
      playBossSound();
    }
  }
  boss.hitFlash = Math.max(0, boss.hitFlash - dt / 0.2);
  boss.attackIn -= dt;
  if (boss.attackIn <= 0) {
    boss.attackIn = BOSS_ATTACK_SECONDS;
    bossAttack();
  }
}

function rallyFullSeconds() {
  return heroIs("knight") ? KNIGHT_RALLY_SECONDS : RALLY_FULL_SECONDS;
}

function rallyBonus() {
  return RALLY_BONUS + partCount("warDrums") * PART_RALLY_BONUS;
}

function toggleRally() {
  if (gameState !== "playing") return;
  if (!rallying) {
    rallying = true;
    rallyHeld = 0;
    return;
  }
  rallying = false;
  if (rallyReserve > 0) {
    const bonus = rallyHeld >= rallyFullSeconds() ? rallyBonus() : 1;
    marchers.push({ side: "player", value: rallyReserve * bonus, t: RALLY_CHARGE_START, charge: true });
    rallyReserve = 0;
    screenShake = Math.max(screenShake, BOMB_SHAKE);
    playBoomSound();
  }
}

function resetRally() {
  rallying = false;
  rallyReserve = 0;
  rallyHeld = 0;
}

function updateRallyButton() {
  const button = document.getElementById("rally-btn");
  const full = rallying && rallyHeld >= rallyFullSeconds();
  const share = rallying ? Math.min(1, rallyHeld / rallyFullSeconds()) : 0;
  // Rounded down, so it only says 100% when it's really full and the label is Charge!
  const label = !rallying ? "Rally" : full ? `Charge! ${Math.round(rallyReserve * rallyBonus())}` : `Charge ${Math.floor(share * 100)}%`;
  setLabel(button, label);
  button.style.setProperty("--charge", `${Math.round(share * 100)}%`);
  button.disabled = gameState !== "playing";
  button.classList.toggle("holding", rallying);
  button.classList.toggle("full", full);
}

function overdriveRecharge() {
  const seconds = OVERDRIVE_COOLDOWN_SECONDS - upgradeLevel("overdriveRecharge") * OVERDRIVE_RECHARGE_PER_LEVEL;
  const cooled = seconds * Math.pow(PART_COOLING, partCount("cooling")) * (ruleOn("slowOverdrive") ? RULE_SLOW_OVERDRIVE : 1);
  return currentEvent?.id === "overdrive" ? cooled / 3 : cooled;
}

function overdriveSeconds() {
  return OVERDRIVE_BASE_SECONDS + upgradeLevel("overdrive") * OVERDRIVE_SECONDS_PER_LEVEL + (heroIs("berserker") ? BERSERKER_OVERDRIVE : 0);
}

function overdriveReady() {
  return overdriveLeft <= 0 && overdriveCooldown <= 0;
}

function activateOverdrive() {
  if (gameState !== "playing" || !overdriveReady()) return;
  overdriveLeft = overdriveSeconds();
  usedOverdrive = true;
  playOverdriveSound();
}

function updateOverdrive(dt) {
  if (overdriveLeft > 0) {
    overdriveLeft -= dt;
    if (overdriveLeft <= 0) {
      overdriveLeft = 0;
      overdriveCooldown = overdriveRecharge();
    }
  } else if (overdriveCooldown > 0) {
    overdriveCooldown = Math.max(0, overdriveCooldown - dt);
  }
}

function updateOverdriveButton() {
  const button = document.getElementById("overdrive-btn");
  // The ring around the button shows the recharge, or what's left while it runs.
  const label = overdriveReady() || overdriveLeft > 0 ? "Overdrive!" : "Overdrive";
  setLabel(button, label);
  button.disabled = !overdriveReady() || gameState !== "playing";
  button.classList.toggle("ready", overdriveReady());
  button.classList.toggle("active", overdriveLeft > 0);
  const charge = overdriveLeft > 0 ? overdriveLeft / overdriveSeconds() : 1 - Math.min(1, overdriveCooldown / overdriveRecharge());
  button.style.setProperty("--charge", `${Math.round(charge * 100)}%`);
}

// =====================================================================
// Input — drag a gear onto another gear to swap them
// =====================================================================

function boardPoint(e) {
  const rect = boardCanvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

// The cell under a board point, or null when the point is off the board.
function cellAt({ x, y }) {
  const col = Math.floor(x / cellSize);
  const row = Math.floor(y / cellSize);
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
  return { row, col, cell: grid[row][col] };
}

// A dragged gear can land on an empty cell or swap with another normal gear.
// The one-tooth gear stays bolted down.
function canDropOn(target) {
  if (drag.tray !== undefined) return target && !target.cell && !isBlocked(target.row, target.col);
  return target && !target.cell?.driver && target.cell !== drag.cell && !isBlocked(target.row, target.col);
}

function machineRate() {
  return soldiersPerSecond() / armyStrength();
}

function formatRate(rate) {
  return rate < 100 ? rate.toFixed(1) : shortNumber(Math.round(rate));
}

// What the machine would produce if the dragged gear were dropped on a cell, or
// null when it can't go there. Tries the move for real, then puts everything back.
function previewDropRate(target) {
  if (!target || target.cell === drag.cell) return null;
  const from = drag.cell;
  if (canFuse(from, target.cell)) return previewFusionRate(target);
  const merging = canMerge(from, target.cell);
  if (!merging && !canDropOn(target)) return null;
  if (drag.tray !== undefined) return previewTrayDropRate(target, merging);
  const { row, col } = drag;
  const onto = target.cell;
  const fromRusted = from.rusted;
  const ontoRusted = onto?.rusted;
  from.rusted = false;
  if (merging) {
    onto.level += 1;
    onto.rusted = false;
    grid[row][col] = null;
  } else {
    grid[row][col] = onto;
    grid[target.row][target.col] = from;
  }
  markCombos();
  const rate = machineRate();
  grid[row][col] = from;
  grid[target.row][target.col] = onto;
  from.rusted = fromRusted;
  if (merging) {
    onto.level -= 1;
    onto.rusted = ontoRusted;
  }
  markCombos();
  return rate;
}

function previewFusionRate(target) {
  const fusion = fusionOf(drag.cell, target.cell);
  const onto = target.cell;
  const fused = freshCell(fusion.gear);
  fused.level = onto.level;
  const fromTray = drag.tray !== undefined;
  grid[target.row][target.col] = fused;
  if (!fromTray) grid[drag.row][drag.col] = null;
  markCombos();
  const rate = machineRate();
  grid[target.row][target.col] = onto;
  if (!fromTray) grid[drag.row][drag.col] = drag.cell;
  markCombos();
  return rate;
}

// The same for a gear from the tray, which has no cell of its own to put back.
function previewTrayDropRate(target, merging) {
  const onto = target.cell;
  if (merging) onto.level += 1;
  else grid[target.row][target.col] = drag.cell;
  markCombos();
  const rate = machineRate();
  if (merging) onto.level -= 1;
  else grid[target.row][target.col] = null;
  markCombos();
  return rate;
}

function updateDragPreview(e) {
  const target = cellAt(boardPoint(e));
  const key = target ? `${target.row},${target.col}` : "";
  if (key === drag.previewKey) return;
  drag.previewKey = key;
  drag.previewRate = previewDropRate(target);
}

function capitalized(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function rewardChip(id, kind) {
  const reward = REWARDS.find((r) => r.id === id);
  const count = partCount(id);
  return { kind, icon: REWARD_ICONS[id] || "✨", count: count > 1 ? count : null, name: reward?.name || id, text: reward?.text || "" };
}

// Most important first: what's hurting now, what's helping now, then rewards with
// the newest first. Each chip shows an icon, plus a small ×N badge when count > 1,
// and carries the name and text its tooltip explains it with.
function statusChips() {
  const chips = [];
  const add = (kind, icon, name, text) => chips.push({ kind, icon, count: null, name, text });
  if (frozenFor > 0) add("bad", STATUS_ICONS.frozen, "Frozen", "The main gear is frozen. Use Lightning to thaw it.");
  if (activeDeal) add("bad", STATUS_ICONS.deal, "Risky deal", capitalized(activeDeal.text));
  if (activePath && activePath.id !== "safe") add("bad", activePath.icon, activePath.name, activePath.risk);
  if (wavePace) add("bad", STATUS_ICONS.pace[wavePace.id] || STATUS_ICONS.deal, wavePace.name, capitalized(NEXT_WAVE_HINTS[wavePace.id === "rush" ? "paceRush" : "paceSiege"]));
  if (hotStreak > 0) chips.push({ kind: "good", icon: "\u{1F525}", count: hotStreak > 1 ? hotStreak : null, name: "Hot streak", text: `Main gear ${Math.round(hotStreak * STREAK.perLevel * 100)}% faster. Win waves within ${STREAK.fastSeconds} seconds to keep it.` });
  if (overdriveLeft > 0) add("good", STATUS_ICONS.overdrive, "Overdrive", "The main gear spins 3x faster for a few seconds, then needs to recharge.");
  if (sparkCharge > 0) add("good", STATUS_ICONS.spark, "Spark charge", `Your next Lightning hits ${Math.round(sparkCharge * 100)}% harder.`);
  if (steamFor > 0) add("good", REACTIONS["fire+ice"].icon, "Steam", "The enemy has stopped growing.");
  else if (chillFor > 0) add("good", STATUS_ICONS.chill, "Chilled", "The enemy grows at half speed.");
  if (rallying) add("good", STATUS_ICONS.rally, "Rally", "Holds arriving soldiers back. When the button says Charge!, press it to charge with 50% more.");
  if (waveEvent?.id === "double") add("good", STATUS_ICONS.doubleEvent, waveEvent.name, capitalized(NEXT_WAVE_HINTS.double));
  if (heroIs("guardian") && !rustBlocked) {
    const hero = HEROES.find((h) => h.id === "guardian");
    add("good", STATUS_ICONS.guardian, hero.name, hero.text);
  }
  if (partCount("secondWind") > 0) chips.push(rewardChip("secondWind", "good"));
  const parts = Object.keys(runParts).filter((id) => id !== "secondWind" && partCount(id) > 0).reverse();
  for (const id of parts) chips.push(rewardChip(id, "part"));
  return chips;
}

const STATUS_CHIP_SIZES = [22, 18, 15]; // every chip stays on show: they shrink to fit, biggest first
let lastStatusKey = "";
let statusRoom = ""; // the row's room for chips, kept up to date by wireStatusTips()
function updateStatusRow() {
  const chips = statusChips();
  const box = document.getElementById("status-row");
  // Also rebuilt when the room for them changes, like turning the phone.
  const key = JSON.stringify([chips, statusRoom]);
  if (key === lastStatusKey) return;
  lastStatusKey = key;
  const row = document.getElementById("status-chips");
  row.replaceChildren(...chips.map(({ kind, icon, count, name, text }) => {
    const chip = document.createElement("span");
    chip.className = `status-chip ${kind}`;
    chip.textContent = icon;
    chip.dataset.name = name;
    chip.dataset.text = text;
    if (count) {
      chip.dataset.count = count;
      const badge = document.createElement("b");
      badge.className = "status-chip-count";
      badge.textContent = `×${count}`;
      chip.append(badge);
    }
    return chip;
  }));
  for (const size of STATUS_CHIP_SIZES) {
    box.style.setProperty("--chip-size", `${size}px`);
    if (box.scrollHeight <= box.clientHeight) break;
  }
  refreshStatusTip();
}

// The row ignores the pointer so gears under it can still be dragged, so this
// looks for a chip under the pointer instead of waiting for the chip to be hit.
const STATUS_TIP_TOUCH_REACH = 6; // chips are small for a finger
const STATUS_TIP_TOUCH_SECONDS = 3;
const STATUS_TIP_TAP_MOVE = 10;
let statusTipName = null;
let statusTipTimer = null;
let statusTipPress = null;

function chipAtPoint(e) {
  const reach = e.pointerType === "mouse" ? 0 : STATUS_TIP_TOUCH_REACH;
  let best = null;
  let bestDistance = Infinity;
  for (const chip of document.querySelectorAll(".status-chip")) {
    const r = chip.getBoundingClientRect();
    const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
    const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
    if (dx > reach || dy > reach) continue;
    const distance = Math.hypot(e.clientX - (r.left + r.right) / 2, e.clientY - (r.top + r.bottom) / 2);
    if (distance < bestDistance) {
      best = chip;
      bestDistance = distance;
    }
  }
  return best;
}

function showStatusTip(chip) {
  const tip = document.getElementById("status-tip");
  const { name, text, count } = chip.dataset;
  statusTipName = name;
  setLabel(document.getElementById("status-tip-name"), count ? `${name} x${count}` : name);
  setLabel(document.getElementById("status-tip-text"), text);
  tip.classList.remove("hidden");
  const wrap = tip.parentElement.getBoundingClientRect();
  const r = chip.getBoundingClientRect();
  const center = (r.left + r.right) / 2 - wrap.left;
  const left = Math.max(6, Math.min(center - tip.offsetWidth / 2, wrap.width - tip.offsetWidth - 6));
  tip.style.left = `${left}px`;
  tip.style.top = `${r.bottom - wrap.top + 7}px`;
  tip.style.setProperty("--arrow-x", `${center - left}px`);
}

function hideStatusTip() {
  statusTipName = null;
  clearTimeout(statusTipTimer);
  document.getElementById("status-tip").classList.add("hidden");
}

// The chips were just rebuilt: follow the same chip, or close if it has gone.
function refreshStatusTip() {
  if (statusTipName === null) return;
  const chip = [...document.querySelectorAll(".status-chip")].find((c) => c.dataset.name === statusTipName);
  if (chip) showStatusTip(chip);
  else hideStatusTip();
}

function wireStatusTips() {
  const wrap = document.getElementById("board-wrap");
  const box = document.getElementById("status-row");
  const rate = document.getElementById("machine-rate");
  // Watched rather than measured every frame, which would make the browser redo its layout.
  const watcher = new ResizeObserver(() => { statusRoom = `${box.clientWidth}|${rate.offsetWidth}`; });
  watcher.observe(box);
  watcher.observe(rate);
  wrap.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    const chip = drag ? null : chipAtPoint(e);
    wrap.style.cursor = chip ? "help" : "";
    if (!chip) hideStatusTip();
    else if (chip.dataset.name !== statusTipName) showStatusTip(chip);
  });
  wrap.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") hideStatusTip(); });
  // There's no hover on a phone, so a tap opens it for a moment. The tap still
  // reaches a gear underneath.
  wrap.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    hideStatusTip();
    statusTipPress = { x: e.clientX, y: e.clientY };
  });
  wrap.addEventListener("pointerup", (e) => {
    if (e.pointerType === "mouse" || !statusTipPress) return;
    const moved = Math.hypot(e.clientX - statusTipPress.x, e.clientY - statusTipPress.y);
    statusTipPress = null;
    const chip = moved <= STATUS_TIP_TAP_MOVE ? chipAtPoint(e) : null;
    if (!chip) return;
    showStatusTip(chip);
    clearTimeout(statusTipTimer);
    statusTipTimer = setTimeout(hideStatusTip, STATUS_TIP_TOUCH_SECONDS * 1000);
  });
}

function updateRateReadout() {
  const el = document.getElementById("machine-rate");
  const now = machineRate();
  const preview = drag?.previewRate ?? null;
  const label = preview === null ? `${formatRate(now)} soldiers/s` : `${formatRate(now)} \u2192 ${formatRate(preview)} soldiers/s`;
  setLabel(el, label);
  el.classList.toggle("up", preview !== null && preview > now + 0.001);
  el.classList.toggle("down", preview !== null && preview < now - 0.001);
}

function onPointerDown(e) {
  ensureAudio();
  if (drag || (gameState !== "playing" && gameState !== "building")) return;
  const point = boardPoint(e);
  const hit = cellAt(point);
  if (!hit || !hit.cell || hit.cell.driver) return;
  e.preventDefault();
  boardCanvas.setPointerCapture(e.pointerId);
  drag = { ...hit, ...point };
}

function onPointerMove(e) {
  if (!drag) return;
  Object.assign(drag, boardPoint(e), { overScrap: drag.tray === undefined && gameState === "playing" && pointerOverScrapZone(e) });
  updateDragPreview(e);
}

function onPointerUp(e) {
  if (!drag) return;
  if (drag.tray !== undefined) {
    dropTrayGear(e);
    return;
  }
  if (gameState === "playing" && pointerOverScrapZone(e)) {
    scrapGear(drag.row, drag.col);
    drag = null;
    return;
  }
  // Handling a rusted gear frees it, whether it was tapped or moved.
  if (drag.cell.rusted) {
    drag.cell.rusted = false;
    recordStat("rustFixed");
    playClankSound();
  }
  const target = cellAt(boardPoint(e));
  if (target && canFuse(drag.cell, target.cell)) {
    grid[drag.row][drag.col] = null;
    fuseOnto(drag.cell, target.row, target.col);
  } else if (target && canMerge(drag.cell, target.cell)) {
    mergeGears(drag.row, drag.col, target.row, target.col);
  } else if (canDropOn(target)) {
    grid[drag.row][drag.col] = target.cell;
    grid[target.row][target.col] = drag.cell;
    playClankSound();
  }
  drag = null;
}

function onTrayPointerDown(e) {
  ensureAudio();
  if (drag || (gameState !== "playing" && gameState !== "building")) return;
  const slot = e.target.closest(".tray-slot");
  const tray = slot ? Number(slot.dataset.index) : -1;
  const item = gearTray[tray];
  if (!item || item.arriving) return;
  e.preventDefault();
  // On the tray rather than the slot, which is rebuilt while it's being dragged.
  e.currentTarget.setPointerCapture(e.pointerId);
  const cell = freshCell(item.type);
  cell.level = item.level;
  drag = { tray, cell, row: -1, col: -1, pressX: e.clientX, pressY: e.clientY, ...boardPoint(e) };
}

// Anywhere it can't go, it just stays in the tray. A tap places it for the
// player, the same spot a new gear has always gone.
function dropTrayGear(e) {
  const { tray, cell, pressX, pressY } = drag;
  const target = cellAt(boardPoint(e));
  if (target && canFuse(cell, target.cell)) {
    gearTray.splice(tray, 1);
    fuseOnto(cell, target.row, target.col);
  } else if (target && canMerge(cell, target.cell)) {
    gearTray.splice(tray, 1);
    levelUpGear(target.row, target.col);
  } else if (canDropOn(target)) {
    placeTrayGear(tray, target.row, target.col);
  } else if (Math.hypot(e.clientX - pressX, e.clientY - pressY) < TAP_SLOP) {
    const spot = bestEmptyCell();
    if (spot) placeTrayGear(tray, spot.row, spot.col);
  }
  drag = null;
}

function placeTrayGear(index, row, col) {
  const [item] = gearTray.splice(index, 1);
  discover(`gear:${item.type}`);
  grid[row][col] = freshCell(item.type);
  grid[row][col].level = item.level;
  grid[row][col].flash = 1;
  playClankSound();
}

let lastTrayKey = "";
function renderGearTray() {
  const held = drag?.tray ?? null;
  const key = JSON.stringify([gearTray, held]);
  if (key === lastTrayKey) return;
  lastTrayKey = key;
  document.getElementById("gear-tray").replaceChildren(...Array.from({ length: TRAY_SLOTS }, (_, i) => {
    const slot = document.createElement("div");
    slot.className = "tray-slot";
    slot.dataset.index = i;
    const item = gearTray[i];
    if (item) {
      slot.classList.add("full");
      slot.classList.toggle("held", held === i);
      slot.classList.toggle("arriving", Boolean(item.arriving));
      slot.append(gearIcon(item.type, false, item.level));
    }
    return slot;
  }));
}

function wireBoardInput() {
  // On press, as it won't hold still for a tap; click is for the keyboard.
  const goblin = document.getElementById("treasure-goblin");
  goblin.addEventListener("pointerdown", (e) => { e.preventDefault(); ensureAudio(); catchTreasureGoblin(); });
  goblin.addEventListener("click", catchTreasureGoblin);
  document.getElementById("chest-continue-btn").addEventListener("click", leaveChests);
  const tray = document.getElementById("gear-tray");
  tray.addEventListener("pointerdown", onTrayPointerDown);
  tray.addEventListener("pointermove", onPointerMove);
  tray.addEventListener("pointerup", onPointerUp);
  tray.addEventListener("pointercancel", () => { drag = null; });
  tray.addEventListener("contextmenu", (e) => e.preventDefault());
  boardCanvas.addEventListener("pointerdown", onPointerDown);
  boardCanvas.addEventListener("pointermove", onPointerMove);
  boardCanvas.addEventListener("pointerup", onPointerUp);
  boardCanvas.addEventListener("pointercancel", () => { drag = null; });
  boardCanvas.addEventListener("contextmenu", (e) => e.preventDefault());
  wireStatusTips();
}

// =====================================================================
// Update loop
// =====================================================================

function streakBoost() {
  return 1 + hotStreak * STREAK.perLevel;
}

// Bosses and siege waves are long on purpose, so they neither build nor break it.
function updateHotStreak() {
  if (boss || wavePace?.id === "siege") return;
  if (waveTime > STREAK.fastSeconds) {
    if (hotStreak > 0) showToast("Hot streak lost");
    hotStreak = 0;
    return;
  }
  hotStreak = Math.min(STREAK.maxLevel, hotStreak + 1);
  recordStat("bestStreak", hotStreak);
}

function updateDrivers(dt) {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = grid[row][col];
      if (!cell?.driver) continue;
      const before = Math.floor(cell.angle / QUARTER_TURN);
      const boost = (overdriveLeft > 0 ? OVERDRIVE_MULTIPLIER : 1) * (frozenFor > 0 ? FROST_SLOW : 1) * streakBoost();
      cell.angle += driverTurnsPerSec * boost * Math.PI * 2 * dt;
      const after = Math.floor(cell.angle / QUARTER_TURN);
      for (let k = before + 1; k <= after; k++) {
        const [dr, dc] = TOOTH_DIRS[(((k * cell.spin) % 4) + 4) % 4];
        tickGear(row + dr, col + dc, cell.spin);
      }
    }
  }
}

// Eases each gear's progress ring and decorative spin toward their
// targets — frame-rate independent so the motion doesn't track
// framerate (the whole reason the enemy in the old game sped up on a
// stall was a per-frame-not-per-time increment; not repeating that here).
function updateGearAnim(dt) {
  const k = Math.min(1, 1 - Math.pow(0.00003, dt));
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = grid[row][col];
      if (!cell) continue;
      cell.ticksAnim += (cell.ticks - cell.ticksAnim) * k;
      cell.spinAnim += (cell.spinTarget - cell.spinAnim) * k;
      if (cell.flash > 0) cell.flash = Math.max(0, cell.flash - dt / 0.4);
    }
  }
}

// A soldier only joins its army's total on reaching the front line.
function updateMarchers(dt) {
  for (const m of marchers) {
    m.t += dt / MARCH_SECONDS;
    if (m.t < 1) continue;
    if (m.side === "player") {
      const value = m.value * (enemyType?.id === "brute" && !partCount("piercing") ? BRUTE_SOLDIER_DAMAGE : 1);
      if (rallying && !m.charge) {
        rallyReserve += value;
      } else {
        playerPower += value;
        damageBoss(value);
      }
    }
    else if (m.side === "bomb") {
      enemyPower = Math.max(1, enemyPower - m.value);
      damageBoss((m.value * WIN_RATIO) / (1 - WIN_RATIO));
      screenShake = Math.max(screenShake, BOMB_SHAKE);
      buzz(25);
      playBoomSound();
    }
    else enemyPower += m.value;
    clashes.push({ t: 0 });
    spawnFrontLineHit(m);
  }
  marchers = marchers.filter((m) => m.t < 1);
  for (const c of clashes) c.t += dt / CLASH_SECONDS;
  clashes = clashes.filter((c) => c.t < 1);
}

// The enemy's size for a new wave: the usual schedule, or more if the player's
// machine would otherwise beat it almost at once. Uses the run's best output so
// unplugging gears just before a wave ends doesn't make the next one smaller.
function waveStartEnemy(forWave) {
  const scheduled = BASE_POWER * Math.pow(worldScale(), forWave - 1);
  const soldiersToWinPerEnemy = WIN_RATIO / (1 - WIN_RATIO) - waveLead;
  return Math.max(scheduled, (peakRate * MIN_WAVE_SECONDS * runLevel().waveSeconds) / soldiersToWinPerEnemy);
}

function winWave() {
  const bossBeaten = Boolean(boss);
  const clearedWorld = isFinalWave(wave);
  updateHotStreak();
  if (boss) {
    const total = playerPower + enemyPower;
    const markerX = 16 + (battleCssW - 32) * (total > 0 ? playerPower / total : 0.5);
    fallenBoss = { boss, x: Math.min(battleCssW - 38, markerX + 32), t: 0 };
    hitStop = HIT_STOP_SECONDS * 2;
    screenShake = Math.max(screenShake, BOMB_SHAKE * 1.5);
    playBoomSound();
  }
  winAt = performance.now();
  buzz(bossBeaten ? 90 : 35);
  showWaveBanner(bossBeaten ? "Boss down!" : hotStreak >= 2 ? `Hot streak x${hotStreak}!` : "Victory!");
  boss = null;
  for (const cell of grid.flat()) {
    if (cell) cell.rusted = false;
  }
  questEvent("waves");
  announceNewFeatures();
  questEvent("reachWave", wave + 1);
  if (!usedOverdrive) questEvent("cleanWave", wave + 1);
  if (bossBeaten) {
    bossesBeaten += 1;
    questEvent("bosses");
    // Beating a boss recharges Overdrive on top of the usual reward.
    overdriveLeft = 0;
    overdriveCooldown = 0;
  }
  wave += 1;
  waveTime = 0;
  marchers = [];
  enemyBacklog = 0;
  waveEvent = null;
  eventReinforcePerSec = 0;
  blockedCells.clear();
  resetRally();
  if (wavePace?.coins) runBonusCoins += wavePace.coins;
  wavePace = null;
  if (activeDeal) {
    runBonusCoins += dealPayout;
    recordStat("deals");
    announce(`Deal won! +${dealPayout} coins`);
  }
  activeDeal = null;
  dealPayout = 0;
  const eliteWon = Boolean(activePath?.lucky);
  if (activePath?.coins) {
    runBonusCoins += activePath.coins;
    announce(`Path won! +${activePath.coins} coins`);
  }
  activePath = null;
  spawnConfetti();
  if (wave > bestWave) {
    bestWave = wave;
    localStorage.setItem("gearfight_best_wave", String(bestWave));
  }
  playWinSound();
  enemyType = null;
  enemyReinforcePerSec = 0;
  frozenFor = 0;
  if (!currentEvent) save.worldBest[WORLDS[currentWorld].id] = Math.max(Number(save.worldBest[WORLDS[currentWorld].id]) || 0, wave);
  checkDailyGoal();
  if (clearedWorld) clearWorld();
  else if (bossBeaten) showChests(pickChestPrizes());
  else offerRewards(bossBeaten ? "Boss defeated!" : eliteWon ? "Elite beaten!" : `Wave ${wave - 1} won!`, bossBeaten || eliteWon);
}

// Reset the balance of power so the new wave starts contested. Carrying the
// player's total over would put them past WIN_RATIO straight away, and waves
// would then fall one after another with nothing happening. This runs after
// the reward is picked so the wave is sized for the machine it will face.
function startWave() {
  peakRate = Math.max(peakRate, soldiersPerSecond());
  const plan = nextWavePlan || planWave(wave);
  nextWavePlan = null;
  wavePace = WAVE_PACES[plan.pace] || null;
  activePath = nextPath;
  nextPath = null;
  activeDeal = dealAccepted ? WAVE_DEALS[plan.deal] || null : null;
  dealPayout = activeDeal ? dealCoins() : 0;
  dealAccepted = false;
  rustBlocked = false;
  enemyPower = waveStartEnemy(wave) * (wavePace ? wavePace.enemy : 1) * (activeDeal?.enemy || 1) * (activePath?.enemy || 1);
  playerPower = enemyPower * (waveLead + nextWaveBonus - runLevel().lead);
  nextWaveBonus = 0;
  fightCount = null;
  discover(`enemy:${enemyRank().look}`);
  if (plan.boss) {
    const hp = bossMaxHp(wave);
    const kind = bossKind(plan.boss);
    discover(`boss:${kind.id}`);
    boss = { kind, hp, maxHp: hp, attackIn: BOSS_FIRST_ATTACK_SECONDS, hitFlash: 0, reinforcePerSec: bossReinforcePerSec(enemyPower), shield: 0, enter: 0 };
    playBossWarningSound();
  } else {
    setEnemyType(plan.enemy);
    if (plan.enemy !== "goblin") discover(`enemy:${plan.enemy}`);
    if (plan.event) startWaveEvent(plan.event);
  }
}

function setEnemyType(id) {
  enemyType = id === "goblin" ? null : ENEMY_TYPES[id];
  enemyPowerIn = ENEMY_POWER_SECONDS / 2;
  enemyReinforcePerSec = id === "runner" ? peakRate * RUNNER_SHARE : 0;
}

function burnGears() {
  const lit = [];
  grid.forEach((row, r) => row.forEach((cell, c) => {
    if (cell && !cell.driver && cell.ticks > 0) lit.push({ r, c });
  }));
  const burned = IMP_GEARS_BURNED - partCount("fireproof");
  for (let i = 0; i < burned && lit.length; i++) {
    const [{ r, c }] = lit.splice(Math.floor(Math.random() * lit.length), 1);
    grid[r][c].ticks = 0;
    grid[r][c].ticksAnim = 0;
    spawnRustBurst(r, c, "#ff8a3d", "#ffcc33");
  }
  showToast("Burned!");
  playRustSound();
}

function updateEnemyType(dt) {
  frozenFor = Math.max(0, frozenFor - dt);
  if ((currentEvent?.id === "rust" || ruleOn("rusty")) && !boss) {
    eventRustIn -= dt;
    if (eventRustIn <= 0) {
      eventRustIn = ruleOn("rusty") ? RULE_RUST_SECONDS : EVENT_RUST_SECONDS;
      rustAttack();
    }
  }
  if (!enemyType || (enemyType.id !== "shaman" && enemyType.id !== "frost" && enemyType.id !== "imp")) return;
  enemyPowerIn -= dt;
  if (enemyPowerIn > 0) return;
  enemyPowerIn = ENEMY_POWER_SECONDS;
  if (enemyType.id === "shaman") rustAttack();
  else if (enemyType.id === "imp") burnGears();
  else {
    frozenFor = FROST_SECONDS / (1 + partCount("antifreeze"));
    showToast("Frozen! Use Lightning to thaw");
    playRustSound();
  }
}

function boardHasGear(type) {
  const needs = { big: "heavy", bomb: "blast", booster: "boosts" }[type];
  return grid.flat().some((cell) => cell && !cell.driver && (cell.type === type || (needs && GEAR_TYPES[cell.type][needs])));
}

// Special gears are limited so that most of a machine is soldier gears.
function specialGearCap() {
  return MAX_SPECIAL_GEARS + upgradeLevel("specials");
}

// Those waiting in the tray count too, or the cap could be passed by placing them.
function specialGearCount() {
  return grid.flat().filter((cell) => cell && !cell.driver && cell.type !== "soldier").length
    + gearTray.filter((item) => item.type !== "soldier").length;
}

function canOfferSpecialGear() {
  return Boolean(bestEmptyCell()) && specialGearCount() < specialGearCap();
}

function rewardIsOpen(reward) {
  if (reward.rarity && !featureOn("rare")) return false;
  if ((reward.id === "farGear" || reward.id === "loneGear") && !featureOn("newGears")) return false;
  if (reward.feature && !featureOn(reward.feature)) return false;
  if (reward.gear) return canOfferSpecialGear();
  if (reward.max && partCount(reward.id) >= reward.max) return false;
  return !reward.available || reward.available();
}

function rewardRarity(reward) {
  return reward.rarity || "common";
}

// One special gear (while one can be offered) plus other rewards, with the rarer
// ones less likely to come up. The power in the sort key is a weighted shuffle.
function pickRewards(lucky, exclude = []) {
  const weights = lucky ? LUCKY_RARITY_WEIGHTS : RARITY_WEIGHTS;
  const random = runRandom(`reward${wave}:${rerollsLeft}`);
  const all = REWARDS.filter(rewardIsOpen);
  const fresh = all.filter((r) => !exclude.includes(r.id));
  const open = fresh.length >= 3 ? fresh : all;
  const shuffled = open.map((r) => [Math.pow(random(), 1 / weights[rewardRarity(r)]), r]).sort((a, b) => b[0] - a[0]).map((pair) => pair[1]);
  const firstGear = shuffled.find((r) => r.gear);
  const rest = shuffled.filter((r) => r !== firstGear);
  return (firstGear ? [firstGear, ...rest] : rest).slice(0, 3 + upgradeLevel("extraChoice"));
}

// Decided now, so reloading can't change what's inside. The same for everyone in
// a daily challenge.
function pickChestPrizes() {
  const random = runRandom(`chest${wave}`);
  const total = CHEST_PRIZES.reduce((sum, prize) => sum + prize.weight, 0);
  return Array.from({ length: CHEST_COUNT }, () => {
    let roll = random() * total;
    return CHEST_PRIZES.find((prize) => (roll -= prize.weight) < 0).id;
  });
}

function chestPrize(id) {
  return CHEST_PRIZES.find((prize) => prize.id === id);
}

function chestPrizeLabel(id) {
  const prize = chestPrize(id);
  return prize.coins ? `+${prize.coins} coins` : `Level ${prize.level} gear`;
}

// A treasure chest, 48 units square. lid: 0 shut, 1 thrown open. Once open,
// light pours out and the prize shows inside: a pile of coins, or a gear.
function drawChest(ctx, open, rare, prizeId = null, lid = open ? 1 : 0, time = 0) {
  const wood = rare ? "#8e2f6e" : "#9a5f2c";
  const woodDark = rare ? "#4f1340" : "#5a3414";
  const woodLight = rare ? "#c0569a" : "#c4834a";
  const metal = rare ? "#ffe28a" : "#ffcc33";
  const left = 7;
  const right = 41;
  const top = 25;
  const bottom = 43;
  const width = right - left;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Light pouring out of an open chest, slowly turning.
  if (lid > 0.4) {
    const shine = Math.min(1, (lid - 0.4) / 0.6);
    const glow = ctx.createRadialGradient(24, 24, 1, 24, 24, 23);
    glow.addColorStop(0, `rgba(255, 236, 150, ${0.95 * shine})`);
    glow.addColorStop(1, "rgba(255, 220, 110, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 48, 48);
    ctx.save();
    ctx.translate(24, 24);
    ctx.rotate(time * 0.6);
    ctx.globalAlpha = shine * (rare ? 0.85 : 0.6);
    for (let i = 0; i < 10; i++) {
      ctx.rotate(Math.PI / 5);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-3.2, -26);
      ctx.lineTo(3.2, -26);
      ctx.closePath();
      ctx.fillStyle = rare && i % 2 ? "#ff9ad5" : "#fff1a8";
      ctx.fill();
    }
    ctx.restore();
  }

  // Shadow.
  ctx.beginPath();
  ctx.ellipse(24, 44, 18, 2.6, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.fill();

  // The open lid, seen from inside, behind the treasure.
  if (lid > 0.5) {
    const h = 13 * Math.min(1, (lid - 0.5) / 0.5);
    ctx.beginPath();
    ctx.moveTo(left + 1, top);
    ctx.lineTo(left + 2.5, top - h);
    ctx.lineTo(right - 2.5, top - h);
    ctx.lineTo(right - 1, top);
    ctx.closePath();
    inked(ctx, woodDark, 1.2);
    if (h > 3) {
      ctx.beginPath();
      ctx.rect(left + 2.5, top - h - 1, width - 5, 2.2);
      inked(ctx, metal, 0.8);
    }
  }

  // What's inside, rising up as the lid opens.
  if (lid > 0.3 && prizeId) {
    const rise = Math.min(1, (lid - 0.3) / 0.7);
    const prize = chestPrize(prizeId);
    ctx.save();
    ctx.translate(0, (1 - rise) * 8);
    if (prize.level) {
      ctx.save();
      ctx.translate(24, top - 4);
      ctx.rotate(time * 1.5);
      traceToothedRim(ctx, 8.5, 6.6, 10);
      inked(ctx, prize.level >= 3 ? "#6fb1ff" : "#e0a92e", 1.1);
      inkedCircle(ctx, 0, 0, 3, prize.level >= 3 ? "#d8ecff" : "#f6e6ae", 0.9);
      ctx.restore();
      ctx.font = "900 6px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = OUTLINE;
      ctx.fillText(String(prize.level), 24, top - 3.6);
    } else {
      const piles = {
        coins: [[18, 0], [24, 0], [30, 0], [21, -3], [27, -3]],
        moreCoins: [[14, 0], [19, 0], [24, 0], [29, 0], [34, 0], [16.5, -3], [21.5, -3], [26.5, -3], [31.5, -3], [19, -6], [24, -6], [29, -6]],
        jackpot: [[12, 0], [17, 0], [22, 0], [27, 0], [32, 0], [36, 0], [14.5, -3], [19.5, -3], [24.5, -3], [29.5, -3], [34, -3], [17, -6], [22, -6], [27, -6], [32, -6], [19.5, -9], [24.5, -9], [29.5, -9], [24, -12]],
      }[prizeId] || [[24, 0]];
      for (const [cx, cy] of piles) {
        ctx.beginPath();
        ctx.ellipse(cx, top - 1 + cy, 3.2, 2, 0, 0, Math.PI * 2);
        inked(ctx, "#ffd23f", 0.8);
        ctx.beginPath();
        ctx.ellipse(cx - 0.8, top - 1.6 + cy, 1.1, 0.6, 0, 0, Math.PI * 2);
        ctx.fillStyle = "#fff7c9";
        ctx.fill();
      }
      if (prizeId === "jackpot") {
        for (const [gx, gy, color] of [[15, -5, "#ff5a8a"], [33, -6, "#5ad1ff"], [24, -15, "#8bd65a"]]) {
          ctx.beginPath();
          ctx.moveTo(gx, top - 1 + gy - 2.6);
          ctx.lineTo(gx + 2, top - 1 + gy);
          ctx.lineTo(gx, top - 1 + gy + 2.6);
          ctx.lineTo(gx - 2, top - 1 + gy);
          ctx.closePath();
          inked(ctx, color, 0.8);
        }
      }
    }
    ctx.restore();
    // The dark mouth of the chest, behind its front edge.
    ctx.beginPath();
    ctx.rect(left + 1.5, top - 1.5, width - 3, 3);
    ctx.fillStyle = "#2a1405";
    ctx.fill();
  }

  // The body: planks, a highlight, gold bands and rivets.
  ctx.beginPath();
  ctx.roundRect(left, top, width, bottom - top, 2);
  inked(ctx, wood, 1.4);
  ctx.strokeStyle = woodDark;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (const y of [31, 37]) {
    ctx.moveTo(left + 1.2, y);
    ctx.lineTo(right - 1.2, y);
  }
  ctx.stroke();
  ctx.strokeStyle = woodLight;
  ctx.beginPath();
  ctx.moveTo(left + 2, top + 1.6);
  ctx.lineTo(right - 2, top + 1.6);
  ctx.stroke();
  for (const x of [12.5, 33]) {
    ctx.beginPath();
    ctx.rect(x, top, 2.6, bottom - top);
    inked(ctx, metal, 0.8);
    ctx.fillStyle = woodDark;
    for (const y of [top + 3, bottom - 3]) {
      ctx.beginPath();
      ctx.arc(x + 1.3, y, 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The shut lid jumps a little as it starts to open, then flips back.
  if (lid < 0.5) {
    const lift = lid * 2;
    const k = 1 - lift * 0.5;
    ctx.save();
    ctx.translate(0, -lift * 6);
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, top - 4);
    ctx.quadraticCurveTo(24, top - 4 - 14 * k, right, top - 4);
    ctx.lineTo(right, top);
    ctx.closePath();
    inked(ctx, wood, 1.4);
    ctx.beginPath();
    ctx.moveTo(left + 3, top - 5);
    ctx.quadraticCurveTo(24, top - 4 - 11 * k, right - 3, top - 5);
    ctx.strokeStyle = woodLight;
    ctx.lineWidth = 0.9;
    ctx.stroke();
    for (const x of [12.5, 33]) {
      ctx.beginPath();
      ctx.rect(x, top - 4 - 5.5 * k, 2.6, 4 + 5.5 * k);
      inked(ctx, metal, 0.8);
    }
    ctx.beginPath();
    ctx.rect(left - 0.5, top - 1.6, width + 1, 2.6);
    inked(ctx, metal, 0.9);
    if (lid === 0) {
      // Padlock with a keyhole.
      ctx.beginPath();
      ctx.roundRect(20.5, top - 3, 7, 8, 1.5);
      inked(ctx, metal, 1);
      inkedCircle(ctx, 24, top + 0.4, 1, "#2a1405", 0.5);
      ctx.beginPath();
      ctx.rect(23.5, top + 0.8, 1, 2.2);
      ctx.fillStyle = "#2a1405";
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}

function chestIcon(open, rare, prizeId = null) {
  return artIcon((ctx) => drawChest(ctx, open, rare, prizeId));
}

function showChests(prizes, picked = null, delay = VICTORY_MS) {
  gameState = "chest";
  drag = null;
  chestPrizes = prizes;
  chestPicked = picked;
  chestOpenAt = [];
  chestCanvases = [];
  rewardOpenedAt = performance.now() + delay;
  renderChests(picked !== null);
  clearTimeout(chestTimer);
  chestTimer = setTimeout(() => {
    if (gameState === "chest") document.getElementById("chest-screen").classList.remove("hidden");
  }, delay);
  saveRun();
}

function chestCanvas() {
  const canvas = document.createElement("canvas");
  canvas.className = "art-icon";
  canvas.width = canvas.height = Math.round(GUIDE_ICON_SIZE * canvasScale() * CHEST_ART_SCALE);
  return canvas;
}

function paintChest(canvas, id, lid, time) {
  const ctx = canvas.getContext("2d");
  const scale = canvas.width / GUIDE_ICON_SIZE;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, GUIDE_ICON_SIZE, GUIDE_ICON_SIZE);
  drawChest(ctx, lid > 0, lid > 0 && Boolean(chestPrize(id).rare), id, lid, time);
  // Faint twinkles on a shut chest that holds something rare, coming and going.
  if (lid === 0 && chestPrize(id).rare) {
    [[10, 16, 0], [37, 21, 2.1], [24, 9, 4.2]].forEach(([x, y, phase]) => {
      const shine = Math.max(0, Math.sin(time * 2.2 + phase));
      if (shine > 0.05) drawTwinkle(ctx, x, y, 2.6 * shine, `rgba(255, 236, 180, ${shine})`);
    });
  }
}

function animateChests() {
  chestFrame = null;
  if (gameState !== "chest" || !chestPrizes) return;
  const now = performance.now();
  chestPrizes.forEach((id, i) => {
    const canvas = chestCanvases[i];
    if (!canvas) return;
    const at = chestOpenAt[i];
    const lid = at === null || at === undefined ? 0 : Math.min(1, Math.max(0, (now - at) / CHEST_LID_MS));
    paintChest(canvas, id, lid, now / 1000);
  });
  chestFrame = requestAnimationFrame(animateChests);
}

function startChestAnimation() {
  if (!chestFrame) chestFrame = requestAnimationFrame(animateChests);
}

// Gold coins, or sparks for a gear, bursting out of the chosen chest.
function spawnChestBurst(card, prize) {
  if (!card || save.lessMotion || REDUCED_MOTION) return;
  const frame = document.getElementById("app-frame").getBoundingClientRect();
  const box = card.getBoundingClientRect();
  const x = box.left + box.width / 2 - frame.left;
  const y = box.top + box.height * 0.4 - frame.top;
  const count = prize.level ? 14 : Math.min(30, 8 + prize.coins / 3);
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + randomBetween(-1.1, 1.1);
    const speed = randomBetween(160, 380);
    spawnParticle({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      gravity: 620,
      life: randomBetween(0.7, 1.2),
      size: randomBetween(4, 7),
      color: prize.level ? (i % 2 ? "#8fe7ff" : "#fff3c4") : i % 3 ? "#ffd23f" : "#fff7c9",
      angle: randomBetween(0, Math.PI),
      spin: randomBetween(-12, 12),
    });
  }
}

function renderChests(revealed) {
  document.getElementById("chest-title").textContent = chestPicked === null ? "Pick a chest!" : "Boss treasure!";
  document.getElementById("chest-continue-btn").classList.toggle("hidden", !revealed);
  const list = document.getElementById("chest-options");
  list.replaceChildren();
  chestPrizes.forEach((id, i) => {
    const button = document.createElement("button");
    const prize = chestPrize(id);
    button.className = "chest-card";
    button.dataset.index = i;
    const chosen = chestPicked === i;
    const open = revealed;
    button.classList.toggle("open", open);
    button.classList.toggle("chosen", open && chosen);
    button.classList.toggle("missed", open && !chosen);
    button.classList.toggle("rare", open && Boolean(prize.rare));
    // A shut chest with a rare prize glows faintly, for players who look closely.
    button.classList.toggle("rare-hint", !open && Boolean(prize.rare));
    button.disabled = chestPicked !== null;
    button.setAttribute("aria-label", open ? chestPrizeLabel(id) : `Open chest ${i + 1}`);
    const label = document.createElement("span");
    label.textContent = open ? chestPrizeLabel(id) : "?";
    // Shown once that chest's lid is open.
    if (open && chestOpenAt[i] > 0) label.style.animationDelay = `${Math.max(0, chestOpenAt[i] - performance.now()) + CHEST_LID_MS * 0.6}ms`;
    if (!open) chestOpenAt[i] = null;
    else if (chestOpenAt[i] === null || chestOpenAt[i] === undefined) chestOpenAt[i] = 0;
    const canvas = chestCanvas();
    chestCanvases[i] = canvas;
    paintChest(canvas, id, chestOpenAt[i] === 0 ? 1 : 0, performance.now() / 1000);
    button.append(canvas, label);
    button.addEventListener("click", () => {
      if (performance.now() - rewardOpenedAt >= REWARD_CLICK_DELAY_MS) pickChest(i);
    });
    list.append(button);
  });
  startChestAnimation();
}

// Paid at once and saved, so closing the game mid-animation can't lose or repeat it.
function pickChest(index) {
  if (gameState !== "chest" || chestPicked !== null || !chestPrizes?.[index]) return;
  chestPicked = index;
  const prize = chestPrize(chestPrizes[index]);
  const card = document.querySelector(`.chest-card[data-index="${index}"]`);
  if (prize.level) {
    if (gearTray.length < TRAY_SLOTS) {
      const frame = document.getElementById("app-frame").getBoundingClientRect();
      const box = card?.getBoundingClientRect();
      sendGearToTray(newGearType(), prize.level, box ? { x: box.left + box.width / 2 - frame.left, y: box.top + box.height / 2 - frame.top } : { x: frame.width / 2, y: frame.height / 2 });
    } else {
      runBonusCoins += CHEST_FULL_TRAY_COINS;
      showToast(`Tray full: +${CHEST_FULL_TRAY_COINS} coins`);
    }
  } else {
    runBonusCoins += prize.coins;
  }
  recordStat("chests");
  saveRun();
  for (const other of document.querySelectorAll(".chest-card")) other.disabled = true;
  card?.classList.add("shaking");
  const quick = save.lessMotion || REDUCED_MOTION;
  if (!quick) for (let i = 0; i < 3; i++) setTimeout(() => playChestRattleSound(i), i * 230);
  clearTimeout(chestTimer);
  chestTimer = setTimeout(() => {
    if (gameState !== "chest") return;
    const now = performance.now();
    chestOpenAt = chestPrizes.map((_, i) => (quick ? 0 : i === index ? now : now + CHEST_REVEAL_MS + [0, 1, 2].filter((j) => j !== index).indexOf(i) * 300));
    renderChests(true);
    playChestOpenSound(Boolean(prize.rare));
    spawnChestBurst(document.querySelector(`.chest-card[data-index="${index}"]`), prize);
    if (prize.rare) spawnConfetti();
  }, quick ? 0 : CHEST_OPEN_MS);
  playClankSound();
}

function leaveChests() {
  if (gameState !== "chest" || chestPicked === null) return;
  clearChests();
  offerRewards("Boss defeated!", true);
}

function clearChests() {
  clearTimeout(chestTimer);
  chestPrizes = null;
  chestPicked = null;
  document.getElementById("chest-screen")?.classList.add("hidden");
}

function offerRewards(title, lucky = false) {
  showRewards(title, pickRewards(lucky), lucky);
  saveRun();
}

function showRewards(title, rewards, lucky = false) {
  gameState = "choosing";
  drag = null;
  offeredRewards = { title, ids: rewards.map((reward) => reward.id), lucky };
  rewardOpenedAt = performance.now() + VICTORY_MS;
  document.getElementById("reward-title").textContent = title;
  renderRewardOptions(rewards);
  nextWavePlan = nextWavePlan || planWave(wave);
  document.getElementById("reward-next").textContent = nextWaveText(nextWavePlan);
  updateDealButton();
  updateRewardActions();
  clearTimeout(rewardTimer);
  rewardTimer = setTimeout(() => {
    if (gameState === "choosing") document.getElementById("reward-screen").classList.remove("hidden");
  }, VICTORY_MS);
}

function dealCoins() {
  return DEAL_BASE_COINS + Math.floor(wave / 2);
}

function updateDealButton() {
  const button = document.getElementById("deal-btn");
  const deal = WAVE_DEALS[nextWavePlan?.deal];
  button.classList.toggle("hidden", !deal);
  if (!deal) return;
  button.textContent = `${dealAccepted ? "Deal taken" : "Risky deal"}: ${deal.text} next wave, win for +${dealCoins()} coins`;
  button.classList.toggle("taken", dealAccepted);
}

function toggleDeal() {
  if (!rewardTapReady()) return;
  dealAccepted = !dealAccepted;
  updateDealButton();
  playClankSound();
  saveRun();
}

function updateRewardActions() {
  document.getElementById("reward-actions").classList.toggle("hidden", !featureOn("reroll"));
  const reroll = document.getElementById("reroll-btn");
  reroll.textContent = `Reroll (${rerollsLeft} left)`;
  reroll.disabled = rerollsLeft <= 0;
  document.getElementById("skip-btn").textContent = `Skip: +${SKIP_COINS} coins`;
}

function rewardTapReady() {
  return gameState === "choosing" && performance.now() - rewardOpenedAt >= REWARD_CLICK_DELAY_MS;
}

function rerollRewards() {
  if (!rewardTapReady() || rerollsLeft <= 0) return;
  rerollsLeft -= 1;
  const rewards = pickRewards(offeredRewards.lucky, offeredRewards.ids);
  offeredRewards.ids = rewards.map((reward) => reward.id);
  renderRewardOptions(rewards);
  updateRewardActions();
  playClankSound();
  saveRun();
}

function skipReward() {
  if (rewardTapReady()) chooseReward(null);
}

const showPercent = (value) => `${Math.round(value * 100)}%`;
const showSeconds = (value) => `${Math.round(value * 10) / 10}s`;
const showPlain = (value) => String(Math.round(value));
const showOnOff = (value) => (value ? "On" : "Off");
const showSpeed = (value) => `${value.toFixed(2)}/s`;

function lightningInOverdrive() {
  const keep = overdriveLeft;
  overdriveLeft = 1;
  const seconds = strikeRecharge();
  overdriveLeft = keep;
  return seconds;
}

function soldiersPerMerge() {
  if (!partCount("forgeBonus")) return 0;
  return Math.max(PART_FORGE_MIN_SOLDIERS, machineRate() * PART_FORGE_SECONDS);
}

// What each reward changes, read from the same numbers the game plays by.
// `value` is worked out with one more of the reward held; `after` is for the
// rewards that change something other than the count of parts.
const REWARD_CHANGES = {
  fasterGear: { label: "Main gear speed", show: showSpeed, value: () => driverTurnsPerSec, after: () => driverTurnsPerSec + DRIVER_SPEED_REWARD },
  clockwork: { label: "Main gear speed", show: showSpeed, value: () => driverTurnsPerSec, after: () => driverTurnsPerSec + PART_CLOCKWORK },
  veterans: { label: "Starting army", show: showPercent, value: () => waveLead - runLevel().lead, after: () => waveLead + VETERANS_REWARD - runLevel().lead },
  reinforcements: { label: "Next wave's army", show: showPercent, value: () => waveLead + nextWaveBonus - runLevel().lead, after: () => waveLead + REINFORCEMENTS_REWARD - runLevel().lead },
  cooling: { label: "Overdrive recharge", show: showSeconds, value: overdriveRecharge },
  staticCharge: { label: "Lightning power", show: showPercent, value: () => 1 + partCount("staticCharge") * PART_STRIKE },
  scrapDealer: { label: "Scrap refund", show: showPercent, value: () => (partCount("scrapDealer") ? PART_SCRAP_REFUND : 0.5) },
  thickOil: { label: "Gears hit by rust", show: showPercent, value: rustShare },
  warChest: { label: "Coins from this run", show: showPercent, value: () => 1 + partCount("warChest") * PART_COINS },
  drillManual: { label: "Training cost", show: showPlain, value: trainCost },
  piercing: { label: "Soldiers against brutes", show: showPercent, value: () => (partCount("piercing") ? 1 : BRUTE_SOLDIER_DAMAGE) },
  antifreeze: { label: "Freeze time", show: showSeconds, value: () => FROST_SECONDS / (1 + partCount("antifreeze")) },
  fireproof: { label: "Gears burned", show: showPlain, value: () => IMP_GEARS_BURNED - partCount("fireproof") },
  longChain: { label: "Hit kept per gear", show: showPercent, value: () => CHAIN_FALLOFF + partCount("longChain") * PART_CHAIN_FALLOFF },
  bossHunter: { label: "Damage to bosses", show: showPercent, value: () => 1 + partCount("bossHunter") * PART_BOSS_DAMAGE },
  demolition: { label: "Bomb gear blast", show: showPercent, value: () => gearPartPayout("bomb") },
  heavyLoad: { label: "Big gear soldiers", show: showPercent, value: () => gearPartPayout("big") },
  turbo: { label: "Booster strength", show: showPercent, value: () => 1 + partCount("turbo") * PART_BOOST },
  blastCleaner: { label: "Rust fixed per blast", show: showPlain, value: () => partCount("blastCleaner") },
  stormEngine: { label: "Lightning in Overdrive", show: showSeconds, value: lightningInOverdrive },
  warDrums: { label: "Full Rally charge", show: showPercent, value: rallyBonus },
  patterns: { label: "Line combo payout", show: showPercent, value: comboLinePayout },
  forgeBonus: { label: "Soldiers per merge", show: showPlain, value: soldiersPerMerge },
  chargedStrike: { label: "Lightning fills gears", show: showOnOff, value: () => partCount("chargedStrike") },
  secondWind: { label: "Second chances", show: showPlain, value: () => partCount("secondWind") },
  promotion: { label: "Army rank", show: (rank) => ARMY_RANKS[rank].name, value: () => armyRank, after: () => armyRank + 1 },
};

// The machine's output with the new gear in the spot it would really go.
function rateWithNewGear(type, level) {
  const spot = bestEmptyCell();
  if (!spot) return null;
  const cell = freshCell(type);
  cell.level = level;
  grid[spot.row][spot.col] = cell;
  markCombos();
  const rate = machineRate();
  grid[spot.row][spot.col] = null;
  markCombos();
  return rate;
}

// { label, from, to } for a reward's card. A new gear shows what it does for the
// machine, or the gear count when it adds nothing yet, like a lone booster.
function rewardChange(reward) {
  if (reward.gear || reward.id === "forgedGear") {
    const rate = machineRate();
    const after = rateWithNewGear(reward.gear || newGearType(), reward.gear ? 1 : FORGED_GEAR_LEVEL);
    if (after !== null && formatRate(after) !== formatRate(rate)) return { label: "Soldiers per second", from: formatRate(rate), to: formatRate(after) };
    const gears = grid.flat().filter((cell) => cell && !cell.driver).length;
    return { label: "Gears on board", from: String(gears), to: String(gears + 1) };
  }
  const spec = REWARD_CHANGES[reward.id];
  if (!spec) return null;
  const from = spec.value();
  let to;
  if (spec.after) {
    to = spec.after();
  } else {
    const held = runParts[reward.id];
    runParts[reward.id] = partCount(reward.id) + 1;
    to = spec.value();
    if (held === undefined) delete runParts[reward.id];
    else runParts[reward.id] = held;
  }
  return { label: spec.label, from: spec.show(from), to: spec.show(to) };
}

function rewardChangeRow(change) {
  const row = document.createElement("div");
  row.className = "reward-change";
  const part = (tag, className, text) => {
    const el = document.createElement(tag);
    el.className = className;
    el.textContent = text;
    return el;
  };
  row.append(part("span", "change-label", change.label), part("span", "change-from", change.from), part("span", "change-arrow", "\u2192"), part("b", "change-to", change.to));
  return row;
}

function renderRewardOptions(rewards) {
  const list = document.getElementById("reward-options");
  list.replaceChildren();
  for (const reward of rewards) {
    const button = document.createElement("button");
    const rarity = rewardRarity(reward);
    button.className = `reward-option ${rarity}`;
    const name = document.createElement("b");
    name.textContent = reward.name;
    if (rarity !== "common") {
      const label = document.createElement("small");
      label.textContent = rarity === "epic" ? "Epic" : "Rare";
      name.append(" ", label);
    }
    const text = document.createElement("span");
    text.textContent = reward.text;
    const words = document.createElement("div");
    words.className = "reward-words";
    words.append(name, text);
    const change = rewardChange(reward);
    if (change) words.append(rewardChangeRow(change));
    button.append(rewardIcon(reward), words);
    button.addEventListener("click", () => {
      if (performance.now() - rewardOpenedAt >= REWARD_CLICK_DELAY_MS) chooseReward(reward);
    });
    list.append(button);
  }
}

function clearEvent() {
  gameState = "worldclear";
  // A run saved last week can still be finished, but only pays as a repeat.
  const firstTime = runEventWeek === weekNumber() && save.eventClearedWeek !== weekNumber();
  const coins = firstTime ? EVENT_CLEAR_COINS : REPEAT_CLEAR_COINS;
  if (firstTime) {
    save.eventClearedWeek = weekNumber();
    recordStat("events");
  }
  save.coins += coins;
  gainXp(WORLD_CLEAR_XP);
  writeSave();
  lastClear = { coins, firstTime };
  saveRun();
  clearTimeout(rewardTimer);
  rewardTimer = setTimeout(showWorldClear, VICTORY_MS);
}

function clearWorld() {
  if (currentEvent) {
    clearEvent();
    return;
  }
  gameState = "worldclear";
  const world = WORLDS[currentWorld];
  const tier = worldLevel + 1;
  const firstTime = clearedTier(world) < tier;
  const coins = firstTime ? Math.round(world.clearCoins * WORLD_LEVELS[worldLevel].clearCoins) : REPEAT_CLEAR_COINS;
  save.worldsCleared[world.id] = true;
  save.worldLevels[world.id] = Math.max(clearedTier(world), tier);
  recordStat("worldTier", tier);
  const earned = awardStars(world);
  save.coins += coins;
  gainXp(WORLD_CLEAR_XP);
  recordStat("worlds", clearedWorldCount());
  writeSave();
  lastClear = { coins, firstTime, earned };
  saveRun();
  clearTimeout(rewardTimer);
  rewardTimer = setTimeout(showWorldClear, VICTORY_MS);
}

// The highest level of a world cleared: 0 for none, 1 for Normal, then Hard and Expert.
function clearedTier(world) {
  return Math.max(Number(save.worldLevels[world.id]) || 0, save.worldsCleared[world.id] ? 1 : 0);
}

// Each world has three stars, kept across all its levels. A head start only counts
// for the first, since the other two are about how the whole machine was built.
function starGoals() {
  const gears = grid.flat().filter((cell) => cell && !cell.driver).length;
  const fullRun = runStartWave === 1 && !runEasy;
  return [
    { text: "Clear the world", done: true },
    { text: "No Overdrive", done: fullRun && !usedOverdrive },
    { text: `${STAR_MAX_GEARS} gears or fewer`, done: fullRun && gears <= STAR_MAX_GEARS },
  ];
}

const STAR_GOAL_TEXT = ["Clear the world", "No Overdrive", `${STAR_MAX_GEARS} gears or fewer`];

function missingStars(world) {
  const missing = STAR_GOAL_TEXT.filter((_, i) => !worldStars(world)[i]);
  return missing.length ? ` Next: ${missing.join(", ")}` : "";
}

function worldStars(world) {
  const stars = save.worldStars[world.id];
  return Array.isArray(stars) ? stars : [false, false, false];
}

function starsText(stars) {
  return stars.map((star) => (star ? "\u2605" : "\u2606")).join("");
}

// Returns the goals newly met, having paid for them.
function awardStars(world) {
  const stars = [...worldStars(world)];
  const fresh = [];
  starGoals().forEach((goal, i) => {
    if (goal.done && !stars[i]) {
      stars[i] = true;
      fresh.push(goal.text);
    }
  });
  save.worldStars[world.id] = stars;
  save.coins += fresh.length * STAR_COINS;
  recordStat("stars", WORLDS.reduce((total, w) => total + worldStars(w).filter(Boolean).length, 0));
  return { stars, fresh };
}

function clearedWorldCount() {
  return WORLDS.filter((w) => save.worldsCleared[w.id]).length;
}

function showWorldClear() {
  if (gameState !== "worldclear") return;
  const world = WORLDS[currentWorld];
  const next = currentEvent ? null : WORLDS[currentWorld + 1];
  document.getElementById("world-clear-title").textContent = `${currentEvent ? currentEvent.name : world.name}${!currentEvent && worldLevel ? ` (${WORLD_LEVELS[worldLevel].name})` : ""} ${currentEvent ? "complete" : "cleared"}!`;
  document.getElementById("world-clear-coins").textContent = `+${lastClear.coins} coins`;
  const story = !currentEvent && lastClear.firstTime && worldLevel === 0 ? WORLD_STORIES[world.id].outro : "";
  document.getElementById("world-clear-story").textContent = story;
  const fresh = lastClear.earned?.fresh ?? [];
  document.getElementById("world-clear-stars").textContent = lastClear.earned
    ? `${starsText(lastClear.earned.stars)}${fresh.length ? ` New: ${fresh.join(", ")} (+${fresh.length * STAR_COINS} coins)` : ""}`
    : "";
  document.getElementById("world-clear-next").textContent = next
    ? (lastClear.firstTime ? `${next.name} unlocked!` : "")
    : currentEvent ? "A new challenge comes next week." : "You have cleared every world!";
  const harderLevel = currentEvent || runEasy ? null : nextWorldLevel(world);
  const harderBtn = document.getElementById("harder-btn");
  harderBtn.classList.toggle("hidden", harderLevel === null);
  if (harderLevel !== null) {
    const comfortable = runLowestShare >= COMFORTABLE_SHARE;
    harderBtn.textContent = `${comfortable ? "Too easy? Try" : "Next challenge:"} ${WORLD_LEVELS[harderLevel].name} · +${levelCoinBonus(harderLevel)}% coins`;
    harderBtn.classList.toggle("comfortable", comfortable);
  }
  const nextBtn = document.getElementById("next-world-btn");
  nextBtn.classList.toggle("hidden", !next);
  if (next) nextBtn.textContent = `Go to ${next.name}`;
  document.getElementById("world-clear-screen").classList.remove("hidden");
}

function hideWorldClear() {
  document.getElementById("world-clear-screen").classList.add("hidden");
}

// Straight into the same world one level harder.
function tryHarderLevel() {
  const level = nextWorldLevel(WORLDS[currentWorld]);
  if (currentEvent || level === null) return;
  bankRun();
  worldLevel = level;
  startNewRun();
}

function goToNextWorld() {
  if (currentEvent || !WORLDS[currentWorld + 1]) return;
  bankRun();
  currentWorld += 1;
  worldLevel = 0;
  startNewRun();
}

// Endless: the run carries on past the final boss, for coins and records.
function keepGoing() {
  endless = true;
  hideWorldClear();
  offerRewards("Endless mode!");
}

function worldUnlocked(index) {
  return index === 0 || Boolean(save.worldsCleared[WORLDS[index - 1].id]);
}

function startChosenRun({ world, event = null, level = 0, daily = null, headStart = false }) {
  currentWorld = world;
  currentEvent = event;
  worldLevel = level;
  currentDaily = daily;
  nextRunHeadStart = headStart;
  document.getElementById("worlds-screen").classList.add("hidden");
  startNewRun();
}

// A small, repeatable random number source, so a day's challenge is the same for
// everyone without a server.
function hashText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function runRandom(salt) {
  return currentDaily ? seededRandom(hashText(`${currentDaily.day}:${salt}`)) : Math.random;
}

function makeDaily(day) {
  const random = seededRandom(hashText(`daily:${day}`));
  const world = Math.floor(random() * WORLDS.length);
  return { day, world, rules: DAILY_RULE_SETS[Math.floor(random() * DAILY_RULE_SETS.length)] };
}

function dailyBestToday() {
  return save.dailyChallengeDay === todayKey() ? save.dailyChallengeBest : 0;
}

function checkDailyGoal() {
  if (!currentDaily || currentDaily.day !== todayKey() || wave < DAILY_GOAL_WAVE || save.dailyChallengePaid === currentDaily.day) return;
  save.dailyChallengePaid = currentDaily.day;
  save.coins += DAILY_GOAL_COINS;
  recordStat("dailyGoals");
  writeSave();
  announce(`Daily goal reached! +${DAILY_GOAL_COINS} coins`);
}

function dailyCard() {
  const daily = makeDaily(todayKey());
  const button = document.createElement("button");
  button.className = "world-card weekly";
  const name = document.createElement("b");
  name.textContent = "Daily challenge";
  const detail = document.createElement("span");
  const best = dailyBestToday();
  detail.textContent = `${WORLDS[daily.world].name}: ${rulesText(daily.rules)}. Reach wave ${DAILY_GOAL_WAVE} for ${DAILY_GOAL_COINS} coins${best ? `. Best today: wave ${best}` : ""}`;
  const mark = document.createElement("em");
  mark.textContent = save.dailyChallengePaid === daily.day ? "\u2713" : "";
  button.append(name, detail, mark);
  button.addEventListener("click", () => startChosenRun({ world: daily.world, daily }));
  return button;
}

function shareText() {
  return t(`Gear Fight! daily challenge ${currentDaily.day}: I reached wave ${wave}. Can you beat it? ${location.origin}${location.pathname}`);
}

async function shareRun() {
  const button = document.getElementById("share-btn");
  const text = shareText();
  try {
    if (navigator.share) {
      await navigator.share({ text });
      return;
    }
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied!";
  } catch (error) {
    // Closing the share sheet isn't a problem; anything else falls back to showing the text.
    if (error?.name !== "AbortError") button.textContent = "Couldn't share";
  }
}

function weeklyCard() {
  const event = weeklyEvent();
  const done = save.eventClearedWeek === weekNumber();
  const button = document.createElement("button");
  button.className = "world-card weekly";
  const name = document.createElement("b");
  name.textContent = `This week: ${event.name}`;
  const detail = document.createElement("span");
  detail.textContent = `${event.text}. Reach wave ${EVENT_FINAL_WAVE} for ${EVENT_CLEAR_COINS} coins`;
  const mark = document.createElement("em");
  mark.textContent = done ? "\u2713" : "";
  button.append(name, detail, mark);
  button.addEventListener("click", () => startChosenRun({ world: weekNumber() % WORLDS.length, event }));
  return button;
}

// A world's picture, drawn once when the list opens rather than every frame.
function worldScene(world) {
  const canvas = document.createElement("canvas");
  canvas.className = "world-scene";
  const w = 420;
  const h = 150;
  const scale = canvasScale();
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  drawWorldScenery(ctx, world.theme, w, h, h - 26, world.finalWave);
  return canvas;
}

function mysteryIcon(icon, known) {
  const wrap = document.createElement("span");
  wrap.className = known ? "world-art" : "world-art unknown";
  wrap.append(icon);
  return wrap;
}

function enemyLook(id) {
  return ENEMY_TYPES[id].look || ENEMY_RANKS[0].look;
}

// Enemies stay a mystery until the player has got far enough to meet them.
function enemySeen(world, joinsAt) {
  return Boolean(save.worldsCleared[world.id]) || (Number(save.worldBest[world.id]) || 0) >= joinsAt;
}

function worldCard(world, i, isNext) {
  const unlocked = worldUnlocked(i);
  const cleared = Boolean(save.worldsCleared[world.id]);
  const best = Number(save.worldBest[world.id]) || 0;
  const button = document.createElement("button");
  button.className = "world-card";
  button.classList.toggle("locked", !unlocked);
  button.classList.toggle("next", isNext);
  button.disabled = !unlocked;

  const top = document.createElement("small");
  top.className = "world-number";
  top.textContent = `World ${i + 1}`;
  const name = document.createElement("b");
  name.textContent = unlocked ? world.name : "???";
  const teaser = document.createElement("span");
  teaser.className = "world-teaser";
  teaser.textContent = WORLD_STORIES[world.id].teaser;
  const words = document.createElement("div");
  words.className = "world-words";
  words.append(top, name, teaser);

  const foes = document.createElement("div");
  foes.className = "world-foes";
  for (const [id, joinsAt] of world.enemies) foes.append(mysteryIcon(enemyIcon(enemyLook(id)), unlocked && enemySeen(world, joinsAt)));
  words.append(foes);

  const detail = document.createElement("span");
  detail.className = "world-detail";
  // A world that's still hidden isn't named here either.
  if (!unlocked) detail.textContent = `Locked: clear ${worldUnlocked(i - 1) ? WORLDS[i - 1].name : `World ${i}`}`;
  else detail.textContent = `Final boss on wave ${world.finalWave}${best ? `, best wave ${best}` : ""}`;
  words.append(detail);

  const kind = FINAL_BOSSES[world.id];
  const bossBox = document.createElement("div");
  bossBox.className = "world-boss";
  const bossName = document.createElement("small");
  bossName.textContent = cleared ? kind.name : "???";
  bossBox.append(mysteryIcon(bossIcon(kind), cleared), bossName);

  const prize = document.createElement("div");
  prize.className = "world-prize";
  const stars = document.createElement("span");
  stars.className = "world-stars";
  for (const star of worldStars(world)) {
    const mark = document.createElement("i");
    mark.className = star ? "" : "empty";
    mark.textContent = star ? "\u2605" : "\u2606";
    stars.append(mark);
  }
  prize.append(stars);
  if (!cleared) {
    const coins = document.createElement("span");
    coins.textContent = `Prize: ${world.clearCoins} coins`;
    prize.append(coins);
  }
  words.append(prize);
  const nextGoal = STAR_GOAL_TEXT.find((_, g) => !worldStars(world)[g]);
  if (unlocked && nextGoal) {
    const goal = document.createElement("span");
    goal.className = "world-goal";
    goal.textContent = `Next star: ${nextGoal}`;
    words.append(goal);
  }

  const mark = document.createElement("em");
  mark.textContent = !unlocked ? "\u{1F512}" : cleared ? "\u2713" : best === 0 ? "New!" : "";
  button.append(worldScene(world), words, bossBox, mark);
  button.addEventListener("click", () => startChosenRun({ world: i }));
  return button;
}

// The level of a world to try next: the one after the highest cleared.
function nextWorldLevel(world) {
  const tier = clearedTier(world);
  return tier >= 1 && tier < WORLD_LEVELS.length ? tier : null;
}

function levelCoinBonus(level) {
  return Math.round((WORLD_LEVELS[level].coins - 1) * 100);
}

function worldExtras(world, i) {
  const extras = document.createElement("div");
  extras.className = "world-extras";
  const later = document.createElement("button");
  later.className = "world-head-start";
  later.textContent = `Start ${world.name} at wave ${HEAD_START_WAVE}`;
  later.addEventListener("click", () => startChosenRun({ world: i, headStart: true }));
  extras.append(later);
  for (let level = 1; level < WORLD_LEVELS.length && clearedTier(world) >= level; level++) {
    const harder = document.createElement("button");
    harder.className = "world-level-btn";
    const done = clearedTier(world) > level ? " \u2713" : "";
    harder.textContent = `${WORLD_LEVELS[level].name}: ${rulesText(levelRules(i, level))}${done}`;
    // The next level to beat stands out, with what it pays.
    if (level === nextWorldLevel(world)) {
      harder.classList.add("suggested");
      const bonus = document.createElement("span");
      bonus.className = "world-level-bonus";
      bonus.textContent = ` · +${levelCoinBonus(level)}% coins`;
      harder.append(bonus);
    }
    harder.addEventListener("click", () => startChosenRun({ world: i, level }));
    extras.append(harder);
  }
  return extras;
}

function openWorlds() {
  const list = document.getElementById("worlds-list");
  list.replaceChildren();
  const cleared = WORLDS.filter((world) => save.worldsCleared[world.id]).length;
  const stars = WORLDS.reduce((sum, world) => sum + worldStars(world).filter(Boolean).length, 0);
  document.getElementById("worlds-progress").textContent = `Worlds cleared: ${cleared}/${WORLDS.length}, stars: ${stars}/${WORLDS.length * STAR_GOAL_TEXT.length}`;
  const easy = document.createElement("button");
  easy.className = "world-easy-btn";
  easy.textContent = `Easy mode: ${save.easy ? "on" : "off"}`;
  easy.addEventListener("click", () => {
    save.easy = !save.easy;
    writeSave();
    openWorlds();
  });
  const events = document.createElement("div");
  events.className = "world-events";
  events.append(dailyCard(), weeklyCard());
  list.append(easy, events);
  const next = WORLDS.findIndex((world, i) => worldUnlocked(i) && !save.worldsCleared[world.id]);
  WORLDS.forEach((world, i) => {
    list.append(worldCard(world, i, i === next));
    if (save.worldsCleared[world.id]) list.append(worldExtras(world, i));
  });
  document.getElementById("worlds-screen").classList.remove("hidden");
}

// Play goes straight in until there is a choice to make.
function pressPlay() {
  if (worldUnlocked(1)) openWorlds();
  else startNewRun();
}

// From the end of a run back to the world list.
function backToWorlds() {
  bankRun();
  gameState = "title";
  hideWorldClear();
  document.getElementById("gameover-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.add("hidden");
  document.getElementById("title-screen").classList.remove("hidden");
  renderWorkshop();
  openWorlds();
}

function chooseReward(reward) {
  clearTimeout(rewardTimer);
  if (!reward) {
    save.coins += SKIP_COINS;
    writeSave();
  } else if (reward.gear) {
    placeGear(reward.gear);
    playClankSound();
  } else {
    if (!reward.oneOff) runParts[reward.id] = partCount(reward.id) + 1;
    reward.apply?.();
    discover(`reward:${reward.id}`);
  }
  offeredRewards = null;
  document.getElementById("reward-screen").classList.add("hidden");
  if (pathChoiceDue()) showPaths(pickPaths());
  else carryOnToWave();
}

function carryOnToWave() {
  if (grid.flat().filter((cell) => cell && !cell.driver).length >= BUILD_MIN_GEARS) startBuildBreak(BUILD_SECONDS);
  else beginWave();
}

function pathChoiceDue() {
  if (wave < PATH_FIRST_WAVE || wave - lastPathWave < PATH_GAP_WAVES) return false;
  const plan = nextWavePlan;
  return Boolean(plan) && !plan.boss && !plan.event && !plan.pace && !plan.deal;
}

// Always the safe road, and two others. The same for everyone in a daily challenge.
function pickPaths() {
  const random = runRandom(`path${wave}`);
  const risky = Object.values(PATHS).filter((path) => path.id !== "safe" && (!path.available || path.available()));
  const shuffled = risky.map((path) => [random(), path.id]).sort((a, b) => a[0] - b[0]).map((pair) => pair[1]);
  return ["safe", ...shuffled.slice(0, 2)];
}

function showPaths(ids) {
  gameState = "path";
  drag = null;
  offeredPaths = ids;
  rewardOpenedAt = performance.now();
  document.getElementById("path-next").textContent = nextWaveText(nextWavePlan);
  const list = document.getElementById("path-options");
  list.replaceChildren();
  for (const id of ids) {
    const path = PATHS[id];
    const button = document.createElement("button");
    button.className = `path-card ${id}`;
    const name = document.createElement("b");
    name.textContent = path.name;
    const risk = document.createElement("span");
    risk.className = "path-risk";
    risk.textContent = path.risk;
    const reward = document.createElement("span");
    reward.className = "path-reward";
    reward.textContent = path.reward;
    const words = document.createElement("div");
    words.className = "reward-words";
    words.append(name, risk, reward);
    button.append(emojiIcon(path.icon), words);
    button.addEventListener("click", () => {
      if (performance.now() - rewardOpenedAt >= REWARD_CLICK_DELAY_MS) choosePath(id);
    });
    list.append(button);
  }
  document.getElementById("path-screen").classList.remove("hidden");
  saveRun();
}

function choosePath(id) {
  const path = PATHS[id];
  offeredPaths = null;
  lastPathWave = wave;
  nextPath = path;
  document.getElementById("path-screen").classList.add("hidden");
  if (path.gearLevel) {
    const frame = document.getElementById("app-frame").getBoundingClientRect();
    sendGearToTray(newGearType(), path.gearLevel, { x: frame.width / 2, y: frame.height / 2 });
  }
  playClankSound();
  carryOnToWave();
}

function clearPaths() {
  offeredPaths = null;
  nextPath = null;
  activePath = null;
  lastPathWave = 0;
  document.getElementById("path-screen")?.classList.add("hidden");
}

// A calm moment to rearrange the machine. The wave is sized when it starts, for
// the machine as it is by then.
function startBuildBreak(seconds) {
  gameState = "building";
  buildLeft = seconds;
  document.getElementById("build-bar").classList.remove("hidden");
  updateBuildBar();
  saveRun();
}

function updateBuildBar() {
  const label = `Rearrange your gears: ${Math.ceil(buildLeft)}`;
  const el = document.getElementById("build-text");
  setLabel(el, label);
}

function updateBuildBreak(dt) {
  buildLeft -= dt;
  updateCombos();
  updateGearAnim(dt);
  updateRateReadout();
  updateStatusRow();
  updateBuildBar();
  if (buildLeft <= 0) beginWave();
}

function beginWave() {
  document.getElementById("build-bar").classList.add("hidden");
  startWave();
  gameState = "playing";
  gearDropAt = planGearDrop();
  treasureAt = activePath?.goblin ? GOBLIN_EARLIEST : planTreasureGoblin();
  if (boss) announce(BOSS_TAUNTS[boss.kind.id]);
  updateFeatureButtons();
  showWaveBanner(boss ? (boss.kind.final ? `${boss.kind.name}!` : "Boss wave!") : activePath && activePath.id !== "safe" ? `${activePath.name}!` : waveEvent ? `${waveEvent.name}!` : wavePace ? `${wavePace.name}!` : `Wave ${wave}!`, Boolean(boss));
  saveRun();
}

function coinsForRun() {
  const base = (wave - runStartWave) * COINS_PER_WAVE + bossesBeaten * COINS_PER_BOSS + runBonusCoins;
  return Math.round(base * (1 + upgradeLevel("coinPurse") * COIN_PURSE_PER_LEVEL) * (1 + partCount("warChest") * PART_COINS) * runCoinScale);
}

// Pays out once per run, whether it ended in defeat or with Restart.
function bankRun() {
  if (runBanked) return 0;
  runBanked = true;
  clearRunSave();
  recordRunEnd();
  const coins = coinsForRun();
  save.coins += coins;
  lastRunXp = XP_PER_RUN + (wave - runStartWave) * XP_PER_WAVE + bossesBeaten * XP_PER_BOSS;
  lastRunLevelUps = gainXp(lastRunXp);
  if (wave > 1 || runTime >= COUNTED_RUN_SECONDS) recordStat("runs");
  writeSave();
  return coins;
}

// Kept only on this device, and included in backups: which wave each run ended
// on, so that it's possible to see where a game tends to stop.
function recordRunEnd() {
  const record = save.funnel[runKey] || (save.funnel[runKey] = {});
  record[wave] = (Number(record[wave]) || 0) + 1;
  save.playSeconds += runTime;
  if (currentDaily && currentDaily.day === todayKey()) {
    save.dailyChallengeBest = Math.max(dailyBestToday(), wave);
    save.dailyChallengeDay = currentDaily.day;
  }
  const levelBefore = heroLevel(save.hero);
  save.heroWaves[save.hero] = (Number(save.heroWaves[save.hero]) || 0) + Math.max(0, wave - runStartWave);
  const levelAfter = heroLevel(save.hero);
  if (levelAfter > levelBefore) announce(`${HEROES.find((h) => h.id === save.hero)?.name} reached level ${levelAfter}!`);
}

function runKeyFor(world, event, daily) {
  return daily ? "daily" : event ? `weekly:${event.id}` : WORLDS[world].id;
}

// The run in progress, as plain data. Effects and animation are left out: they
// start fresh and never change the outcome.
function runSnapshot() {
  return {
    version: RUN_SAVE_VERSION,
    state: gameState,
    world: currentWorld,
    event: currentEvent?.id ?? null,
    eventWeek: runEventWeek,
    grid: grid.map((row) => row.map((cell) => cell && {
      type: cell.type,
      level: cell.level,
      ticks: cell.ticks,
      rusted: Boolean(cell.rusted),
      driver: Boolean(cell.driver),
      angle: cell.angle,
      spin: cell.spin,
    })),
    boss: boss && { kind: boss.kind.id, hp: boss.hp, maxHp: boss.maxHp, attackIn: boss.attackIn, reinforcePerSec: boss.reinforcePerSec, shield: boss.shield, gearDropped: Boolean(boss.gearDropped) },
    enemyType: enemyType?.id ?? null,
    waveEvent: waveEvent?.id ?? null,
    blockedCells: [...blockedCells],
    marchers,
    parts: runParts,
    offered: offeredRewards,
    chests: { prizes: chestPrizes, picked: chestPicked },
    paths: { offered: offeredPaths, next: nextPath?.id ?? null, active: activePath?.id ?? null },
    nextPlan: nextWavePlan,
    daily: currentDaily,
    rules: runRules,
    tray: gearTray.map(({ type, level }) => ({ type, level })),
    wavePace: wavePace?.id ?? null,
    lastClear,
    comboCounts,
    numbers: {
      wave, waveTime, playerPower, enemyPower, totalArmyScore, enemyBacklog,
      peakRate, driverTurnsPerSec, waveLead, nextWaveBonus,
      lastTipAt, bossesBeaten, enemiesBlasted, runQuestCoins, runTime, bestWaveBeforeRun,
      eventRustIn, enemyPowerIn, frozenFor, enemyReinforcePerSec, armyRank, rallyReserve, rallyHeld,
      eventAttackIn, eventReinforcePerSec, overdriveLeft, overdriveCooldown, strikeCooldown,
      buildLeft, dealPayout, strikeHeld, rerollsLeft, runStartWave, worldLevel, runCoinScale, runBonusCoins, strikeCount, gearDropAt, treasureAt, lastPathWave, hotStreak,
    },
    flags: { endless, usedOverdrive, rallying, rustBlocked, dealAccepted, runEasy, pausedFromBuild },
    activeDeal: activeDeal?.id ?? null,
    lastEventId,
  };
}

function saveRun() {
  runSaveIn = RUN_SAVE_SECONDS;
  if (runBanked || !RUN_SAVE_STATES.includes(gameState)) return;
  try {
    localStorage.setItem(RUN_SAVE_KEY, JSON.stringify(runSnapshot()));
  } catch {
    // Without storage, the run simply lasts until the page closes.
  }
}

function clearRunSave() {
  savedRun = null;
  updateContinueButton();
  try {
    localStorage.removeItem(RUN_SAVE_KEY);
  } catch {
    // Nothing was stored, then.
  }
}

// A damaged or outdated save is ignored rather than breaking the game.
function isValidRunSave(data) {
  if (data?.version !== RUN_SAVE_VERSION || !RUN_SAVE_STATES.includes(data.state) || !WORLDS[data.world]) return false;
  if (data.event !== null && !WEEKLY_EVENTS.some((e) => e.id === data.event)) return false;
  if (!Array.isArray(data.grid) || data.grid.length !== ROWS) return false;
  const cellsOk = data.grid.every((row) => Array.isArray(row) && row.length === COLS
    && row.every((cell) => cell === null || (GEAR_TYPES[cell.type] && cell.level >= 1 && cell.level <= MAX_GEAR_LEVEL && Number.isFinite(cell.ticks))));
  if (!cellsOk || !data.grid[DRIVER_ROW][DRIVER_COL]?.driver || !Number.isFinite(data.grid[DRIVER_ROW][DRIVER_COL].angle)) return false;
  if (!data.numbers || !Object.values(data.numbers).every(Number.isFinite)) return false;
  if (!(data.numbers.wave >= 1) || !ARMY_RANKS[data.numbers.armyRank]) return false;
  if (!Array.isArray(data.marchers) || !Array.isArray(data.blockedCells)) return false;
  if (!data.parts || typeof data.parts !== "object" || !data.comboCounts || !data.flags) return false;
  if (data.boss && !bossKind(data.boss.kind)) return false;
  if (data.enemyType !== null && !ENEMY_TYPES[data.enemyType]) return false;
  if (data.waveEvent !== null && !WAVE_EVENTS.some((e) => e.id === data.waveEvent)) return false;
  if (data.state === "chest" && !(Array.isArray(data.chests?.prizes) && data.chests.prizes.length === CHEST_COUNT && data.chests.prizes.every((id) => chestPrize(id)))) return false;
  if (data.state === "path" && !(Array.isArray(data.paths?.offered) && data.paths.offered.length && data.paths.offered.every((id) => PATHS[id]))) return false;
  if (data.state === "choosing" && !data.offered?.ids?.every((id) => REWARDS.some((r) => r.id === id))) return false;
  if (data.state === "worldclear" && !data.lastClear) return false;
  return true;
}

function loadRunSave() {
  try {
    const data = JSON.parse(localStorage.getItem(RUN_SAVE_KEY));
    return isValidRunSave(data) ? data : null;
  } catch {
    return null;
  }
}

function restoreRun(data) {
  fightCount = null;
  currentWorld = data.world;
  currentEvent = WEEKLY_EVENTS.find((e) => e.id === data.event) || null;
  runEventWeek = data.eventWeek;
  grid = data.grid.map((row) => row.map((cell) => {
    if (!cell) return null;
    const restored = { ...freshCell(cell.type), level: cell.level, ticks: cell.ticks, ticksAnim: cell.ticks, rusted: cell.rusted };
    if (cell.driver) Object.assign(restored, { driver: true, angle: cell.angle, spin: cell.spin });
    return restored;
  }));
  const n = data.numbers;
  ({ wave, waveTime, playerPower, enemyPower, totalArmyScore, enemyBacklog } = n);
  ({ peakRate, driverTurnsPerSec, waveLead, nextWaveBonus } = n);
  ({ lastTipAt, bossesBeaten, enemiesBlasted, runQuestCoins, runTime, bestWaveBeforeRun } = n);
  ({ eventRustIn, enemyPowerIn, frozenFor, enemyReinforcePerSec, armyRank, rallyReserve, rallyHeld } = n);
  ({ eventAttackIn, eventReinforcePerSec, overdriveLeft, overdriveCooldown, strikeCooldown } = n);
  // Saves from before rerolls and head starts don't have these.
  rerollsLeft = n.rerollsLeft ?? REROLLS_PER_RUN;
  runStartWave = n.runStartWave ?? 1;
  nextWavePlan = data.nextPlan ?? null;
  ({ endless, usedOverdrive, rallying } = data.flags);
  // Saves from before harder levels and the daily challenge don't have these.
  currentDaily = data.daily ?? null;
  runRules = (data.rules ?? []).filter((rule) => RULES[rule]);
  // Saves from before the tray don't have one.
  gearTray = (data.tray ?? []).filter((item) => GEAR_TYPES[item?.type] && item.level >= 1 && item.level <= MAX_GEAR_LEVEL).slice(0, TRAY_SLOTS);
  worldLevel = n.worldLevel ?? 0;
  runCoinScale = n.runCoinScale ?? 1;
  runBonusCoins = n.runBonusCoins ?? 0;
  strikeCount = n.strikeCount ?? 0;
  gearDropAt = n.gearDropAt ?? NO_GEAR_DROP;
  treasureAt = n.treasureAt ?? NO_GEAR_DROP;
  // Saves from before routes don't have these.
  clearPaths();
  lastPathWave = n.lastPathWave ?? 0;
  hotStreak = n.hotStreak ?? 0;
  nextPath = PATHS[data.paths?.next] || null;
  activePath = PATHS[data.paths?.active] || null;
  clearTreasureGoblin();
  rustBlocked = Boolean(data.flags.rustBlocked);
  dealAccepted = Boolean(data.flags.dealAccepted);
  runEasy = Boolean(data.flags.runEasy);
  activeDeal = WAVE_DEALS[data.activeDeal] || null;
  dealPayout = n.dealPayout ?? 0;
  strikeHeld = n.strikeHeld ?? 0;
  wavePace = WAVE_PACES[data.wavePace] || null;
  runKey = runKeyFor(currentWorld, currentEvent, currentDaily);
  boss = data.boss && { ...data.boss, kind: bossKind(data.boss.kind), hitFlash: 0 };
  enemyType = data.enemyType && ENEMY_TYPES[data.enemyType];
  waveEvent = data.waveEvent && WAVE_EVENTS.find((e) => e.id === data.waveEvent);
  lastEventId = data.lastEventId;
  blockedCells = new Set(data.blockedCells);
  marchers = data.marchers;
  clashes = [];
  runParts = data.parts;
  lastClear = data.lastClear;
  comboCounts = data.comboCounts;
  offeredRewards = null;
  runBanked = false;
}

// Back into a saved run, always stopped so the player can get their bearings.
function continueRun() {
  if (!savedRun) return;
  ensureAudio();
  const data = savedRun;
  savedRun = null;
  restoreRun(data);
  updateCombos();
  document.getElementById("title-screen").classList.add("hidden");
  document.getElementById("worlds-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");
  gameState = "playing";
  handleResize();
  document.getElementById("wave-num").textContent = wave;
  updateOverdriveButton();
  updateRallyButton();
  updateTrainButton();
  updateStrikeButton();
  updateFeatureButtons();
  if (data.state === "chest") showChests(data.chests.prizes, data.chests.picked ?? null, 0);
  else if (data.state === "path") showPaths(data.paths.offered);
  else if (data.state === "choosing") showRewards(data.offered.title, data.offered.ids.map((id) => REWARDS.find((r) => r.id === id)), data.offered.lucky);
  else if (data.state === "worldclear") {
    gameState = "worldclear";
    showWorldClear();
  } else if (data.state === "building" || data.flags.pausedFromBuild) {
    startBuildBreak(data.numbers.buildLeft ?? BUILD_SECONDS);
    if (data.state === "paused") pauseGame();
  } else pauseGame();
  updateContinueButton();
}

function runDescription(data) {
  const level = data.flags.runEasy ? ` (${EASY_LEVEL.name})` : data.numbers.worldLevel ? ` (${WORLD_LEVELS[data.numbers.worldLevel].name})` : "";
  const name = data.daily ? "Daily challenge" : data.event !== null ? WEEKLY_EVENTS.find((e) => e.id === data.event).name : `${WORLDS[data.world].name}${level}`;
  return `${name}, wave ${data.numbers.wave}`;
}

// Starting something new gives up the saved run, so the title screen says so.
function updateContinueButton() {
  const button = document.getElementById("continue-btn");
  button.classList.toggle("hidden", !savedRun);
  if (savedRun) button.textContent = `Continue: ${runDescription(savedRun)}`;
  const play = document.getElementById("play-btn");
  play.classList.toggle("has-run", Boolean(savedRun));
  play.textContent = savedRun ? "New game (ends this run)" : "Play game";
}

function formatTime(seconds) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

// The goals that are nearly in reach, to make the next run tempting.
function nextGoals() {
  const goals = [];
  if (wave > 1 && wave <= bestWaveBeforeRun) {
    const gap = bestWaveBeforeRun - wave + 1;
    goals.push(`${gap} ${gap === 1 ? "wave" : "waves"} to beat your record of ${bestWaveBeforeRun}!`);
  }
  const options = UPGRADES.filter((u) => upgradeLevel(u.id) < u.costs.length).map((u) => ({ name: u.name, cost: u.costs[upgradeLevel(u.id)] }));
  if (options.length) {
    const cheapest = options.reduce((a, b) => (b.cost < a.cost ? b : a));
    goals.push(save.coins >= cheapest.cost
      ? `You can afford ${cheapest.name} in the Workshop!`
      : `Only ${cheapest.cost - save.coins} coins to ${cheapest.name}`);
  }
  const open = [...save.quests, ...save.dailyQuests.filter((q) => !q.done)];
  if (open.length) {
    const closest = open.reduce((a, b) => (b.progress / b.target > a.progress / a.target ? b : a));
    if (closest.progress > 0) goals.push(`Quest: ${questInfo(closest).text(closest.target)} (${Math.floor(closest.progress)}/${closest.target})`);
  }
  return goals.slice(0, 2);
}

// The machine keeps turning while the game is closed, up to a limit.
function checkAwayEarnings() {
  const minutes = (Date.now() - save.lastSeen) / 60000;
  if (!save.lastSeen || minutes < AWAY_MIN_MINUTES || statValue("runs") === 0) return;
  const hours = Math.min(AWAY_MAX_HOURS, minutes / 60);
  const coins = Math.floor(hours * (AWAY_COINS_PER_HOUR + save.playerLevel));
  if (coins < 1) return;
  save.coins += coins;
  writeSave();
  renderWorkshop();
  document.getElementById("away-coins").textContent = coins;
  document.getElementById("away-screen").classList.remove("hidden");
}

function backupText() {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    save,
    bestWave,
    run: localStorage.getItem(RUN_SAVE_KEY),
  });
}

// Returns what to restore, or null when the text isn't a Gear Fight backup.
function parseBackup(text) {
  try {
    const data = JSON.parse(text);
    if (data?.format !== BACKUP_FORMAT || data.version !== BACKUP_VERSION) return null;
    if (!data.save || typeof data.save !== "object" || !Number.isFinite(data.save.coins)) return null;
    return data;
  } catch {
    return null;
  }
}

function backupMessage(text) {
  document.getElementById("backup-message").textContent = text;
}

function openBackup() {
  document.getElementById("backup-text").value = backupText();
  backupMessage("Keep this somewhere safe. Restoring it brings back your progress on any device.");
  document.getElementById("restore-btn").textContent = "Restore from text above";
  document.getElementById("backup-screen").classList.remove("hidden");
}

function downloadBackup() {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([backupText()], { type: "application/json" }));
  link.download = `gear-fight-backup-${todayKey()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  backupMessage("Backup file saved.");
}

async function copyBackup() {
  try {
    await navigator.clipboard.writeText(backupText());
    backupMessage("Backup copied.");
  } catch {
    document.getElementById("backup-text").select();
    backupMessage("Couldn't copy by itself. Select the text above and copy it.");
  }
}

async function loadBackupFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  document.getElementById("backup-text").value = await file.text();
  event.target.value = "";
  backupMessage("Backup loaded. Tap Restore to use it.");
}

// Replaces everything, so the first tap only asks for a second.
function restoreBackup() {
  const button = document.getElementById("restore-btn");
  const data = parseBackup(document.getElementById("backup-text").value);
  if (!data) {
    backupMessage("That isn't a Gear Fight backup. Nothing was changed.");
    return;
  }
  if (button.dataset.armed !== "yes") {
    button.dataset.armed = "yes";
    button.textContent = "Tap again to replace your progress";
    return;
  }
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data.save));
    localStorage.setItem("gearfight_best_wave", String(Number(data.bestWave) || 1));
    if (typeof data.run === "string") localStorage.setItem(RUN_SAVE_KEY, data.run);
    else localStorage.removeItem(RUN_SAVE_KEY);
  } catch {
    backupMessage("Couldn't save on this device. Nothing was changed.");
    return;
  }
  // The page leaving must not write the old progress back over the backup.
  restoringBackup = true;
  location.reload();
}

function leavingPage() {
  if (restoringBackup) return;
  writeSave();
  saveRun();
}

function showRunSummary(coins) {
  renderRunBuild();
  const hooks = document.getElementById("gameover-goals");
  hooks.replaceChildren();
  for (const goal of nextGoals()) {
    const line = document.createElement("p");
    line.textContent = goal;
    hooks.append(line);
  }
  document.getElementById("final-wave").textContent = wave;
  document.getElementById("new-record").classList.toggle("hidden", wave <= bestWaveBeforeRun);
  document.getElementById("stat-soldiers").textContent = Math.round(totalArmyScore);
  document.getElementById("stat-bosses").textContent = bossesBeaten;
  document.getElementById("stat-blasted").textContent = enemiesBlasted;
  document.getElementById("stat-time").textContent = formatTime(runTime);
  document.getElementById("coins-earned").textContent = runQuestCoins > 0
    ? `+${coins} coins, plus ${runQuestCoins} from quests`
    : `+${coins} coins`;
  const levelLine = document.getElementById("level-gain");
  const lastUp = lastRunLevelUps[lastRunLevelUps.length - 1];
  const levelCoins = lastRunLevelUps.reduce((total, up) => total + up.coins, 0);
  levelLine.textContent = lastUp
    ? `+${lastRunXp} XP. Level ${lastUp.level}! +${levelCoins} coins`
    : `+${lastRunXp} XP. Level ${save.playerLevel}: ${save.xp} / ${xpForNextLevel()}`;
  levelLine.classList.toggle("leveled", Boolean(lastUp));
  const share = document.getElementById("share-btn");
  share.classList.toggle("hidden", !currentDaily);
  share.textContent = "Share your score";
  document.getElementById("gameover-screen").classList.remove("hidden");
}

function runPartNames() {
  return REWARDS.filter((reward) => partCount(reward.id) > 0)
    .map((reward) => (partCount(reward.id) > 1 ? `${reward.name} x${partCount(reward.id)}` : reward.name));
}

// The machine and rewards this run ended with, so that it feels like its own build.
function renderRunBuild() {
  const gears = grid.flat().filter((cell) => cell && !cell.driver);
  const top = gears.reduce((best, cell) => Math.max(best, cell.level), 0);
  const parts = runPartNames();
  const shown = parts.slice(0, 5).join(", ") + (parts.length > 5 ? ` +${parts.length - 5} more` : "");
  document.getElementById("run-build-gears").textContent = `${gears.length} ${gears.length === 1 ? "gear" : "gears"}, top level ${top}`;
  document.getElementById("run-build-parts").textContent = parts.length ? `Rewards: ${shown}` : "";
}

function renderRunParts() {
  const owned = runPartNames();
  const line = document.getElementById("pause-parts");
  line.textContent = owned.length ? `This run: ${owned.join(", ")}` : "";
  line.classList.toggle("hidden", !owned.length);
}

function pauseGame() {
  if (gameState !== "playing" && gameState !== "building") return;
  pausedFromBuild = gameState === "building";
  gameState = "paused";
  drag = null;
  renderQuestList("pause-quests");
  renderRunParts();
  document.getElementById("pause-screen").classList.remove("hidden");
}

// From the pause menu to the title screen. The run is kept, so Continue on
// the title screen picks it up again where it was paused.
function goHome() {
  if (gameState !== "paused") return;
  saveRun();
  savedRun = JSON.parse(JSON.stringify(runSnapshot()));
  gameState = "title";
  drag = null;
  document.getElementById("pause-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.add("hidden");
  document.getElementById("title-screen").classList.remove("hidden");
  updateContinueButton();
  renderWorkshop();
}

function resumeGame() {
  if (gameState !== "paused") return;
  gameState = pausedFromBuild ? "building" : "playing";
  pausedFromBuild = false;
  document.getElementById("pause-screen").classList.add("hidden");
}

function bossCard() {
  return { label: "New boss!", name: boss.kind.name, hint: NEXT_WAVE_HINTS[boss.kind.id] || "", icon: bossIcon(boss.kind) };
}

function enemyTypeCard(id) {
  return { label: "New enemy!", name: ENEMY_TYPES[id].name, hint: NEXT_WAVE_HINTS[id] || "", icon: enemyIcon(ENEMY_TYPES[id].look) };
}

// A tip with a card shows who it's about: a big picture, a name and what it does.
function showTipCard(tip) {
  const card = tip.card?.();
  document.getElementById("tip-intro").classList.toggle("hidden", !card);
  if (!card) return;
  document.getElementById("tip-intro-art").replaceChildren(card.icon);
  document.getElementById("tip-intro-label").textContent = card.label;
  document.getElementById("tip-intro-name").textContent = card.name;
  const hint = document.getElementById("tip-intro-hint");
  hint.textContent = card.hint;
  hint.classList.toggle("hidden", !card.hint);
}

function maybeShowTip() {
  if (gameState !== "playing") return;
  const since = runTime - lastTipAt;
  const canWait = since < TIP_GAP_SECONDS;
  const urgentCanWait = since < URGENT_TIP_GAP_SECONDS;
  const tip = TIPS.find((tip) => !save.tips[tip.id] && !(canWait && !tip.urgent) && !(urgentCanWait && tip.urgent && lastTipAt > 0) && (!TIP_FEATURES[tip.id] || featureOn(TIP_FEATURES[tip.id])) && tip.when());
  if (!tip) return;
  if (!tip.id.startsWith("story:")) lastTipAt = Math.max(runTime, 0.001);
  gameState = "tip";
  drag = null;
  openTip = tip;
  tipOpenedAt = performance.now();
  document.getElementById("tip-text").textContent = tip.text;
  showTipCard(tip);
  document.getElementById("tip-screen").classList.remove("hidden");
  if (tip.target) document.querySelector(tip.target).classList.add("tip-target");
}

function hideTip() {
  document.getElementById("tip-screen").classList.add("hidden");
  for (const el of document.querySelectorAll(".tip-target")) el.classList.remove("tip-target");
  openTip = null;
}

function closeTip() {
  if (!openTip || performance.now() - tipOpenedAt < REWARD_CLICK_DELAY_MS) return;
  save.tips[openTip.id] = true;
  if (openTip.id === "boss" && boss) save.tips[`boss:${boss.kind.id}`] = true;
  writeSave();
  hideTip();
  gameState = "playing";
}

// Shows every tip again from the start of a new run.
function replayTips() {
  document.getElementById("more-screen").classList.add("hidden");
  save.tips = {};
  writeSave();
  if (savedRun) continueRun();
  else startNewRun();
}

// Second wind: the line goes back to even and the enemies on their way are lost.
function useSecondWind() {
  runParts.secondWind -= 1;
  playerPower = enemyPower;
  marchers = marchers.filter((m) => m.side !== "enemy");
  screenShake = Math.max(screenShake, BOMB_SHAKE * 1.5);
  buzz([40, 40, 80]);
  showWaveBanner("Second wind!");
  spawnConfetti();
  playWinSound();
}

function gameOver() {
  gameState = "gameover";
  drag = null;
  showRunSummary(bankRun());
  buzz(150);
  showDailyReward();
  playLoseSound();
}

function update(dt) {
  if (gameState === "building") {
    updateBuildBreak(dt);
    return;
  }
  if (gameState !== "playing") return;
  runTime += dt;
  updateCombos();
  updateOverdrive(dt);
  strikeCooldown = Math.max(0, strikeCooldown - dt);
  strikeHeld = strikeCooldown > 0 ? 0 : strikeHeld + dt;
  if (rallying) rallyHeld += dt;
  updateBoss(dt);
  updateWaveEvent(dt);
  updateEnemyType(dt);
  updateDrivers(dt);
  updateGearAnim(dt);
  updateMarchers(dt);
  peakRate = Math.max(peakRate, soldiersPerSecond());

  waveTime += dt;
  chillFor = Math.max(0, chillFor - dt);
  steamFor = Math.max(0, steamFor - dt);
  const growthScale = (steamFor > 0 ? 0 : chillFor > 0 ? ICE_GROWTH : 1) * (wavePace ? wavePace.growth : 1) * (ruleOn("swarm") ? RULE_SWARM : 1) * runLevel().growth * (activeDeal?.growth || 1) * (activePath?.growth || 1);
  enemyBacklog += (enemyGrowthPerSec(wave, waveTime) * growthScale + (boss ? boss.reinforcePerSec : 0) + eventReinforcePerSec + enemyReinforcePerSec) * dt;
  const newEnemies = Math.floor(enemyBacklog);
  if (newEnemies > 0) {
    enemyBacklog -= newEnemies;
    sendMarcher("enemy", newEnemies);
  }
  const total = playerPower + enemyPower;
  const ratio = total > 0 ? playerPower / total : 0.5;
  runLowestShare = Math.min(runLowestShare, ratio);
  const won = boss ? boss.hp <= 0 : ratio >= WIN_RATIO;
  if (won) winWave();
  else if (ratio <= LOSE_RATIO) {
    if (partCount("secondWind") > 0) useSecondWind();
    else gameOver();
  }

  document.getElementById("wave-num").textContent = wave;
  updateOverdriveButton();
  updateRallyButton();
  updateTrainButton();
  updateStrikeButton();
  updateRateReadout();
  updateStatusRow();
  maybeShowTip();
  runSaveIn -= dt;
  if (runSaveIn <= 0) saveRun();
}

// =====================================================================
// Rendering
// =====================================================================

function roundRectFill(ctx, x, y, w, h, r, fill) {
  if (w <= 0 || h <= 0) return;
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

// Flat cartoon colour rather than shaded metal.
function metalGradient(ctx, r, palette) {
  return palette.mid;
}

// Machined details shared by both gear types, drawn around the origin: a
// sunken web, lightening holes that make the turning easy to see, and a hub.
function drawGearFace(ctx, rWeb, rHub, palette) {
  ctx.beginPath();
  ctx.arc(0, 0, rWeb, 0, Math.PI * 2);
  ctx.fillStyle = palette.recess;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = palette.dark;
  ctx.stroke();

  const holeOrbit = (rWeb + rHub) / 2;
  const holeR = (rWeb - rHub) * 0.3;
  ctx.fillStyle = palette.dark;
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * holeOrbit, Math.sin(a) * holeOrbit, holeR, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(0, 0, rHub, 0, Math.PI * 2);
  ctx.fillStyle = palette.hub;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = palette.dark;
  ctx.stroke();
}

// A gear outline with flat-topped, tapered teeth, drawn around the origin.
function traceToothedRim(ctx, rTip, rRoot, teeth) {
  const pitch = (Math.PI * 2) / teeth;
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a = i * pitch;
    const points = [[rRoot, -0.3], [rTip, -0.15], [rTip, 0.15], [rRoot, 0.3]];
    for (const [radius, offset] of points) {
      const angle = a + offset * pitch;
      ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    ctx.arc(0, 0, rRoot, a + 0.3 * pitch, a + 0.7 * pitch);
  }
  ctx.closePath();
}

// The one-tooth gear: a smooth steel wheel with a single tooth long enough
// to visibly reach into the neighbouring gear as it sweeps past.
function drawDriverCell(ctx, cx, cy, size, cell) {
  const r = size * 0.38;
  const halfRoot = size * 0.11;
  const halfTip = size * 0.06;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(cell.angle * cell.spin);
  if (frozenFor > 0) {
    ctx.shadowColor = "#a8e6ff";
    ctx.shadowBlur = glowBlur(size * 0.45);
  } else if (overdriveLeft > 0) {
    ctx.shadowColor = "#ff8a3d";
    ctx.shadowBlur = glowBlur(size * 0.45);
  }

  ctx.beginPath();
  ctx.moveTo(r * 0.9, -halfRoot);
  ctx.lineTo(size * 0.62, -halfTip);
  ctx.lineTo(size * 0.62, halfTip);
  ctx.lineTo(r * 0.9, halfRoot);
  ctx.closePath();
  ctx.fillStyle = DRIVER_PALETTE.mid;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = metalGradient(ctx, r, DRIVER_PALETTE);
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  drawGearFace(ctx, r * 0.78, r * 0.3, DRIVER_PALETTE);
  ctx.restore();

  // The main gear is the hero of the machine, so it gets a happy face that
  // stays upright while it turns.
  drawCartoonEyes(ctx, cx - size * 0.02, cy - size * 0.05, size * 0.065, false);
  ctx.beginPath();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(1.5, size * 0.03);
  ctx.lineCap = "round";
  ctx.arc(cx, cy + size * 0.06, size * 0.09, 0.25, Math.PI - 0.25);
  ctx.stroke();
}

// Drawing a gear's body is slow and a full board has dozens, so each colour is
// drawn once and reused as an image. Redrawn if the cell size or scale changes.
const gearSprites = new Map(); // palette -> canvas
let gearSpriteKey = "";

function gearSprite(palette) {
  const scale = canvasScale();
  const key = `${cellSize}:${scale}`;
  if (key !== gearSpriteKey) {
    gearSprites.clear();
    gearSpriteKey = key;
  }
  let sprite = gearSprites.get(palette);
  if (!sprite) {
    const r = cellSize * 0.48;
    const lineWidth = Math.max(2, cellSize * 0.045);
    const half = r + lineWidth;
    sprite = document.createElement("canvas");
    sprite.width = sprite.height = Math.ceil(half * 2 * scale);
    sprite.halfSize = sprite.width / scale / 2;
    const ctx = sprite.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, sprite.width / 2, sprite.height / 2);
    traceToothedRim(ctx, r, r * 0.84, TOOTH_COUNT);
    ctx.fillStyle = metalGradient(ctx, r, palette);
    ctx.fill();
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = "round";
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    drawGearFace(ctx, r * 0.72, r * 0.46, palette);
    gearSprites.set(palette, sprite);
  }
  return sprite;
}

function drawElementDot(ctx, cx, cy, size, element) {
  const x = cx + size * 0.3;
  const y = cy - size * 0.3;
  const r = size * 0.1;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = ELEMENT_COLORS[element];
  ctx.fill();
  ctx.lineWidth = Math.max(1, size * 0.025);
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  if (element === "fire") {
    ctx.moveTo(x, y - r * 0.6);
    ctx.quadraticCurveTo(x + r * 0.55, y, x, y + r * 0.55);
    ctx.quadraticCurveTo(x - r * 0.55, y, x, y - r * 0.6);
  } else if (element === "ice") {
    // A six-armed snowflake.
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = r * 0.22;
    ctx.lineCap = "round";
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI + Math.PI / 2;
      ctx.moveTo(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62);
      ctx.lineTo(x - Math.cos(a) * r * 0.62, y - Math.sin(a) * r * 0.62);
    }
    ctx.stroke();
    ctx.restore();
    return;
  } else {
    ctx.moveTo(x + r * 0.1, y - r * 0.65);
    ctx.lineTo(x - r * 0.4, y + r * 0.1);
    ctx.lineTo(x, y + r * 0.1);
    ctx.lineTo(x - r * 0.1, y + r * 0.65);
    ctx.lineTo(x + r * 0.4, y - r * 0.1);
    ctx.lineTo(x, y - r * 0.1);
  }
  ctx.fill();
  ctx.restore();
}

function drawGearCell(ctx, cx, cy, size, cell) {
  const flashBoost = 1 + cell.flash * 0.06;
  const r = size * 0.48 * flashBoost;
  const spec = GEAR_TYPES[cell.type];
  const palette = cell.rusted ? RUST_PALETTE : spec.palette;
  if (spec.super && !cell.rusted) {
    const pulse = 0.75 + Math.sin(performance.now() / 300) * 0.25;
    const glow = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 1.25);
    glow.addColorStop(0, `rgba(255, 215, 80, ${0.9 * pulse})`);
    glow.addColorStop(1, "rgba(255, 215, 80, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(cx - r * 1.3, cy - r * 1.3, r * 2.6, r * 2.6);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.08, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 225, 77, ${pulse})`;
    ctx.lineWidth = Math.max(1.5, r * 0.09);
    ctx.stroke();
  }

  // The gear body visibly turns one tooth per hit. It never resets, so it
  // keeps turning rather than snapping back.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(cell.spinAnim * TICK_ANGLE);
  if (cell.flash > 0) {
    ctx.shadowColor = "#ffcc33";
    ctx.shadowBlur = glowBlur(size * 0.3 * cell.flash);
  }
  const sprite = gearSprite(palette);
  const half = sprite.halfSize * (size / cellSize) * flashBoost;
  ctx.drawImage(sprite, -half, -half, half * 2, half * 2);
  ctx.restore();

  // A coloured ring marks gears that are part of a combo.
  if (cell.comboLine || cell.comboBlock || cell.comboRing) {
    ctx.beginPath();
    ctx.lineWidth = Math.max(2, size * 0.04);
    ctx.strokeStyle = cell.comboRing ? "#c8f59a" : cell.comboBlock ? "#8fe7ff" : "#ffcc33";
    ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Progress ring — how close this gear is to sending a soldier. It stays
  // still while the body turns, so it always reads the same way.
  const progress = spec.hits && !cell.rusted ? Math.max(0, Math.min(1, cell.ticksAnim / spec.hits)) : 0;
  if (progress > 0) {
    ctx.beginPath();
    ctx.lineWidth = Math.max(2, size * 0.05);
    ctx.strokeStyle = "#fffbe6";
    ctx.lineCap = "round";
    const start = -Math.PI / 2;
    ctx.arc(cx, cy, r * 0.6, start, start + progress * Math.PI * 2);
    ctx.stroke();
  }

  if (cell.rusted) {
    ctx.fillStyle = "#2a1b08";
    ctx.font = `800 ${Math.round(r * 0.34)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("TAP", cx, cy + 1);
    return;
  }
  if (!spec.hits) {
    drawBolt(ctx, cx, cy, r * 0.34, palette.dark);
    drawLevelMark(ctx, cx, cy, r, cell.level);
    return;
  }
  ctx.fillStyle = "#2a1b08";
  ctx.font = `800 ${Math.round(r * 0.34)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${Math.round((cell.ticks / spec.hits) * 100)}%`, cx, cy + 1);

  const payout = levelPayout(cell.level);
  const badge = spec.mark ? spec.mark : spec.enemies ? `-${spec.enemies * payout}` : spec.soldiers * payout > 1 ? `x${spec.soldiers * payout}` : "";
  if (badge) {
    roundRectFill(ctx, cx - r * 0.38, cy + r * 0.52, r * 0.76, r * 0.4, r * 0.15, palette.dark);
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 ${Math.round(r * 0.3)}px system-ui, sans-serif`;
    ctx.fillText(badge, cx, cy + r * 0.73);
  }
  if (spec.element) drawElementDot(ctx, cx, cy, size, spec.element);
  drawLevelMark(ctx, cx, cy, r, cell.level);
}

// A pill on top of the gear showing its merge level.
function drawLevelMark(ctx, cx, cy, r, level) {
  if (level <= 1) return;
  roundRectFill(ctx, cx - r * 0.3, cy - r * 0.92, r * 0.6, r * 0.38, r * 0.15, "#2a1b08");
  ctx.fillStyle = "#ffcc33";
  ctx.font = `800 ${Math.round(r * 0.28)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`L${level}`, cx, cy - r * 0.72);
}

// The booster's mark: a lightning bolt.
function drawBolt(ctx, cx, cy, size, color) {
  const points = [[0.2, -1], [-0.6, 0.15], [-0.05, 0.15], [-0.2, 1], [0.6, -0.2], [0.05, -0.2]];
  ctx.beginPath();
  for (const [x, y] of points) ctx.lineTo(cx + x * size, cy + y * size);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

// Sparks where a booster touches another gear, so its reach is easy to see.
// The gears really getting a booster's extra: joined to the main gear, and able
// to fill. A gear touching a booster but cut off from the chain gets nothing.
function boostedGears() {
  const seen = new Set();
  const out = [];
  for (const [dr, dc] of TOOTH_DIRS) {
    for (const { row, col } of connectedGears(DRIVER_ROW + dr, DRIVER_COL + dc, 1)) {
      const key = `${row},${col}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const cell = grid[row][col];
      if (!GEAR_TYPES[cell.type].hits) continue;
      const boost = boostersTouching(row, col);
      if (boost > 0) out.push({ row, col, boost });
    }
  }
  return out;
}

// Drawn once and reused: a blur for every gear on every frame would slow the game.
let auraSprite = null;
let auraSpriteSize = 0;
function boostAuraSprite() {
  const size = Math.round(cellSize * AURA_SIZE * canvasScale());
  if (size === auraSpriteSize) return auraSprite;
  auraSpriteSize = size;
  auraSprite = document.createElement("canvas");
  auraSprite.width = auraSprite.height = Math.max(1, size);
  const ctx = auraSprite.getContext("2d");
  const r = size / 2;
  const glow = ctx.createRadialGradient(r, r, 0, r, r, r);
  glow.addColorStop(0, "rgba(190, 255, 120, 0.95)");
  glow.addColorStop(0.72, "rgba(190, 255, 120, 0.95)");
  glow.addColorStop(0.85, "rgba(150, 245, 80, 0.65)");
  glow.addColorStop(1, "rgba(150, 245, 80, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  return auraSprite;
}

// Behind the gears, stronger with more boost.
function drawBoostAuras(ctx) {
  const gears = boostedGears();
  if (!gears.length) return;
  const sprite = boostAuraSprite();
  const pulse = REDUCED_MOTION || save.lessMotion ? 0.85 : 0.75 + Math.sin(performance.now() / 260) * 0.25;
  const size = cellSize * AURA_SIZE;
  for (const { row, col, boost } of gears) {
    if (drag?.cell === grid[row][col]) continue;
    ctx.globalAlpha = Math.min(1, (AURA_BASE_ALPHA + boost * AURA_ALPHA_PER_BOOST) * pulse);
    ctx.drawImage(sprite, (col + 0.5) * cellSize - size / 2, (row + 0.5) * cellSize - size / 2, size, size);
  }
  ctx.globalAlpha = 1;
}

function drawStreakGlow(ctx) {
  if (hotStreak <= 0) return;
  const cx = (DRIVER_COL + 0.5) * cellSize;
  const cy = (DRIVER_ROW + 0.5) * cellSize;
  const pulse = REDUCED_MOTION || save.lessMotion ? 0.9 : 0.8 + Math.sin(performance.now() / 150) * 0.2;
  const r = cellSize * (0.72 + hotStreak * 0.07);
  const glow = ctx.createRadialGradient(cx, cy, cellSize * 0.3, cx, cy, r);
  glow.addColorStop(0, `rgba(255, 150, 40, ${0.85 * pulse})`);
  glow.addColorStop(1, "rgba(255, 90, 20, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawBoostLinks(ctx) {
  const pulse = 0.65 + Math.sin(performance.now() / 180) * 0.35;
  ctx.fillStyle = `rgba(190, 255, 120, ${pulse})`;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (!grid[row][col] || !GEAR_TYPES[grid[row][col].type].boosts || grid[row][col].rusted) continue;
      for (const [dr, dc] of TOOTH_DIRS) {
        const other = grid[row + dr]?.[col + dc];
        if (!other || other.driver || other.rusted) continue;
        ctx.beginPath();
        ctx.arc((col + 0.5 + dc / 2) * cellSize, (row + 0.5 + dr / 2) * cellSize, cellSize * 0.09, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

// A glowing dash between two touching gears that will react, in both colours.
function drawReactionLinks(ctx) {
  const pulse = 0.55 + Math.sin(performance.now() / 220) * 0.35;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = cellSize * 0.08;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const other = grid[row + dr]?.[col + dc];
        const reaction = reactionBetween(grid[row][col], other);
        if (!reaction) continue;
        const x = (col + 0.5 + dc / 2) * cellSize;
        const y = (row + 0.5 + dr / 2) * cellSize;
        const half = cellSize * 0.16;
        ctx.globalAlpha = pulse;
        ctx.strokeStyle = ELEMENT_COLORS[GEAR_TYPES[grid[row][col].type].element];
        ctx.beginPath();
        ctx.moveTo(x - dc * half - dr * 0, y - dr * half);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.strokeStyle = ELEMENT_COLORS[GEAR_TYPES[other.type].element];
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + dc * half, y + dr * half);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

// Marks a cell a gear can be dragged into.
function drawEmptyCell(ctx, cx, cy, size) {
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.08, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(70, 40, 15, 0.35)";
  ctx.fill();
}

// While a gear is held, fades the gears it can't merge with and rings the ones
// it can, so matches are easy to spot on a busy board.
function drawMergeHints(ctx) {
  const pulse = REDUCED_MOTION ? 0.5 : 0.5 + Math.sin(performance.now() / 130) * 0.5;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = grid[row][col];
      if (!cell || cell.driver || cell === drag.cell) continue;
      const cx = col * cellSize + cellSize / 2;
      const cy = row * cellSize + cellSize / 2;
      ctx.beginPath();
      const fusing = canFuse(drag.cell, cell);
      if (fusing || canMerge(drag.cell, cell)) {
        ctx.arc(cx, cy, cellSize * (0.47 + pulse * 0.04), 0, Math.PI * 2);
        ctx.lineWidth = Math.max(3, cellSize * 0.07);
        ctx.strokeStyle = fusing ? "#d08cff" : "#7dff5a";
        ctx.shadowColor = fusing ? "#d08cff" : "#7dff5a";
        ctx.shadowBlur = glowBlur(cellSize * 0.25);
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else {
        ctx.arc(cx, cy, cellSize * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(40, 22, 8, 0.55)";
        ctx.fill();
      }
    }
  }
}

// A cartoon wooden workbench under the gears.
function drawWoodBoard(ctx) {
  roundRectFill(ctx, 0, 0, boardCssW, boardCssH, 14, "#a9743f");
  ctx.strokeStyle = "#8a5a2c";
  ctx.lineWidth = 2;
  for (let row = 1; row < ROWS; row++) {
    ctx.beginPath();
    ctx.moveTo(4, row * cellSize);
    ctx.lineTo(boardCssW - 4, row * cellSize);
    ctx.stroke();
  }
  ctx.fillStyle = "#6d4520";
  for (const [x, y] of [[9, 9], [boardCssW - 9, 9], [9, boardCssH - 9], [boardCssW - 9, boardCssH - 9]]) {
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBlockedCell(ctx, cx, cy, size) {
  const half = size * 0.2;
  ctx.lineWidth = Math.max(2, size * 0.05);
  ctx.strokeStyle = "rgba(216, 67, 47, 0.75)";
  ctx.beginPath();
  ctx.moveTo(cx - half, cy - half);
  ctx.lineTo(cx + half, cy + half);
  ctx.moveTo(cx + half, cy - half);
  ctx.lineTo(cx - half, cy + half);
  ctx.stroke();
}

function drawBoard() {
  // grid isn't populated until startNewRun()/createBoard() runs (on Play).
  // A stray resize event before that — the address bar collapsing, a
  // rotation, anything — can still set up boardCtx/boardCssW via
  // layoutBoardCanvas() while the title screen is still showing, so guard
  // on the grid itself too rather than just the canvas being ready.
  if (!boardCtx || boardCssW <= 0 || grid.length < ROWS) return;
  const ctx = boardCtx;
  ctx.clearRect(0, 0, boardCssW, boardCssH);
  drawWoodBoard(ctx);
  drawBoostAuras(ctx);
  drawStreakGlow(ctx);

  // The one-tooth gear goes on top so its tooth overlaps the gears it touches.
  for (const drawDrivers of [false, true]) {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cell = grid[row][col];
        const cx = col * cellSize + cellSize / 2;
        const cy = row * cellSize + cellSize / 2;
        if (!cell) {
          if (!drawDrivers) {
            if (isBlocked(row, col)) drawBlockedCell(ctx, cx, cy, cellSize);
            else drawEmptyCell(ctx, cx, cy, cellSize);
          }
          continue;
        }
        if (Boolean(cell.driver) !== drawDrivers) continue;
        if (drag && drag.cell === cell) continue;
        if (drawDrivers) drawDriverCell(ctx, cx, cy, cellSize, cell);
        else drawGearCell(ctx, cx, cy, cellSize, cell);
      }
    }
  }

  drawBoostLinks(ctx);
  drawReactionLinks(ctx);

  // The dragged gear follows the pointer, above everything else, with an
  // outline on the gear it would swap with.
  if (drag) {
    drawMergeHints(ctx);
    const target = cellAt(drag);
    if (canDropOn(target) || (target && (canMerge(drag.cell, target.cell) || canFuse(drag.cell, target.cell)))) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = target && canFuse(drag.cell, target.cell) ? "#d08cff" : canMerge(drag.cell, target.cell) ? "#8bd65a" : "#ffcc33";
      ctx.strokeRect(target.col * cellSize + 3, target.row * cellSize + 3, cellSize - 6, cellSize - 6);
    }
    if (drag.tray === undefined) drawGearCell(ctx, drag.x, drag.y, cellSize * 1.12, drag.cell);
  }
}

const SOLDIER_LOOKS = {
  runner: { style: "rider", tunic: "#d6b13a", trim: "#7a5716", skin: "#9ccc5a", horns: "#2f2410", blade: "#c3ccd5", size: 0.92 },
  brute: { style: "boar", tunic: "#59606b", trim: "#2a2f36", skin: "#6f8f45", horns: "#c3ccd5", blade: "#3f4a55", size: 1.35 },
  shaman: { style: "shaman", tunic: "#5b3a8a", trim: "#2c1a4a", skin: "#8a7fb0", horns: "#a4552a", blade: "#a4552a", size: 1.05 },
  frost: { style: "yeti", tunic: "#3f7fa8", trim: "#1d4560", skin: "#a8e0f5", horns: "#ffffff", blade: "#d8f6ff", glow: "#a8e6ff", size: 1.3 },
  imp: { style: "imp", tunic: "#3a1208", trim: "#1c0804", skin: "#f06a2a", horns: "#1c0a06", blade: "#ffcc33", glow: "#ff8a3d", size: 0.98 },
  r0: { style: "recruit", tunic: "#3a7ddb", trim: "#1f4a7a", skin: "#f3d5b0", helmet: "#c3ccd5", blade: "#eef2f5", size: 1 },
  r1: { style: "knight", tunic: "#8d99a6", trim: "#3f4a55", skin: "#f3d5b0", helmet: "#dfe5ea", blade: "#ffffff", plume: "#3a7ddb", size: 1.12 },
  r2: { style: "champion", tunic: "#e0a92e", trim: "#7a5716", skin: "#f3d5b0", helmet: "#ffe28a", blade: "#ffffff", plume: "#d8432f", cape: "#b5261a", size: 1.25 },
  r3: { style: "hero", tunic: "#fff0b8", trim: "#b98a1e", skin: "#f3d5b0", helmet: "#ffffff", blade: "#8fe7ff", plume: "#8fe7ff", cape: "#3a7ddb", glow: "#ffe28a", size: 1.4 },
  charge: { tunic: "#ffcc33", trim: "#a06d10", skin: "#f3d5b0", helmet: "#fff3c4", blade: "#ffffff", size: 1.1 },
  e0: { style: "goblin", tunic: "#a32a1c", trim: "#5e140a", skin: "#7fa84a", horns: "#2f2410", blade: "#6e4a24", size: 1 },
  e1: { style: "orc", tunic: "#5a3a20", trim: "#2a1b08", skin: "#4f7a33", horns: "#e8dcc0", blade: "#8d99a6", size: 1.15 },
  e2: { style: "troll", tunic: "#4a5560", trim: "#262c33", skin: "#7a93a3", horns: "#d7dfe6", blade: "#59402a", size: 1.3 },
  e3: { style: "demon", tunic: "#2a1020", trim: "#120610", skin: "#c2362a", horns: "#1c0a06", blade: "#ff8a3d", glow: "#ff5a2a", size: 1.42 },
};

const OUTLINE = "#22150b";

function battleArtScale() {
  return Math.max(0.85, Math.min(1.2, battleCssH / 92));
}

// Fills and outlines the current path, the look everything cartoon here shares.
function inked(ctx, fill, width = 1.4) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = width;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

function inkedCircle(ctx, x, y, r, fill, width) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  inked(ctx, fill, width);
}

// Big round eyes looking the way the character faces.
function drawCartoonEyes(ctx, x, y, size, angry, mood = "neutral") {
  for (const offset of [-size * 1.05, size * 1.05]) {
    if (mood === "wince") {
      // Eyes squeezed shut.
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = size * 0.5;
      ctx.beginPath();
      ctx.moveTo(x + offset - size * 0.7, y - size * 0.5);
      ctx.lineTo(x + offset + size * 0.7, y);
      ctx.lineTo(x + offset - size * 0.7, y + size * 0.5);
      ctx.stroke();
      continue;
    }
    ctx.beginPath();
    ctx.ellipse(x + offset, y, size * 0.85, size, 0, 0, Math.PI * 2);
    inked(ctx, "#ffffff", 0.8);
    ctx.beginPath();
    ctx.fillStyle = OUTLINE;
    ctx.arc(x + offset + size * 0.3, y + size * 0.1, size * (mood === "scared" ? 0.25 : 0.45), 0, Math.PI * 2);
    ctx.fill();
  }
  if (angry && mood !== "scared" && mood !== "wince") {
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = size * 0.55;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + side * size * 2, y - size * 1.5);
      ctx.lineTo(x + side * size * 0.3, y - size * 0.8);
      ctx.stroke();
    }
  }
}

// A chunky cartoon soldier standing on `feetY`, facing +1 (right) or -1 (left).
// state: "idle" bounces, "walk" moves its legs, "fight" swings its weapon.
// `seed` keeps a crowd from moving in step.
function drawSoldier(ctx, x, feetY, facing, look, state, seed, mood = "neutral") {
  const colors = SOLDIER_LOOKS[look];
  const time = performance.now() / 1000 + seed * 0.37;
  const stride = state === "flee" ? Math.sin(time * 22) * 3 : state === "walk" ? Math.sin(time * 14) * 2.6 : 0;
  const hop = state === "cheer" ? Math.abs(Math.sin(time * 8)) * 7 : state === "walk" ? Math.abs(Math.sin(time * 14)) * 1.6 : 0;
  // Squash and stretch: a soft bounce that makes them feel alive.
  const squash = state === "idle" ? Math.sin(time * 3) * 0.04 : state === "fight" ? Math.sin(time * 11) * 0.06 : 0;
  const swing = state === "cheer" ? -0.3 + Math.sin(time * 16) * 0.5 : state === "flee" ? 1.8 : state === "fight" ? -0.5 + Math.sin(time * 11) * 1.1 : state === "walk" ? -0.3 + Math.sin(time * 14) * 0.3 : -0.5;
  const scale = colors.size * battleArtScale();
  ctx.save();
  ctx.translate(x, feetY - hop);
  ctx.scale(facing * scale * (1 - squash), scale * (1 + squash));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (colors.glow) {
    ctx.shadowColor = colors.glow;
    ctx.shadowBlur = glowBlur(8);
  }
  if (colors.horns) {
    (MONSTER_STYLES[colors.style] || MONSTER_STYLES.goblin)(ctx, colors, state, time, stride, swing, mood);
    ctx.restore();
    return;
  }
  (KNIGHT_STYLES[colors.style] || drawKnight)(ctx, colors, state, time, stride, swing, mood);
  ctx.restore();
}

// Small shared bits for the faces that show: a mouth for each mood, and a
// nervous sweat drop.
function drawSmallMouth(ctx, x, y, mood) {
  ctx.beginPath();
  if (mood === "happy") {
    ctx.arc(x, y - 1, 2.2, 0, Math.PI);
    ctx.closePath();
    inked(ctx, "#a8322a", 0.8);
  } else if (mood === "scared") {
    ctx.ellipse(x, y, 1.2, 1.6, 0, 0, Math.PI * 2);
    inked(ctx, "#3a0d06", 0.7);
  } else if (mood === "wince") {
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 0.9;
    ctx.moveTo(x - 1.8, y);
    ctx.lineTo(x - 0.6, y - 0.9);
    ctx.lineTo(x + 0.6, y);
    ctx.lineTo(x + 1.8, y - 0.9);
    ctx.stroke();
  } else {
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 0.9;
    ctx.arc(x, y - 1, 1.7, 0.25, Math.PI - 0.25);
    ctx.stroke();
  }
}

function drawSweatDrop(ctx, x, y) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x - 3, y + 4, x, y + 4.6);
  ctx.quadraticCurveTo(x + 2.6, y + 3.6, x, y);
  inked(ctx, "#a8e6ff", 0.7);
}

// Eyes seen through a helmet's opening, for each mood.
function drawVisorEyes(ctx, spots, mood) {
  for (const [ex, ey] of spots) {
    if (mood === "wince" || mood === "happy") {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      if (mood === "happy") {
        ctx.moveTo(ex - 0.9, ey + 0.5);
        ctx.lineTo(ex, ey - 0.5);
        ctx.lineTo(ex + 0.9, ey + 0.5);
      } else {
        ctx.moveTo(ex - 0.8, ey - 0.6);
        ctx.lineTo(ex + 0.6, ey);
        ctx.lineTo(ex - 0.8, ey + 0.6);
      }
      ctx.stroke();
      continue;
    }
    const r = mood === "scared" ? 1.2 : 0.9;
    ctx.beginPath();
    ctx.fillStyle = "#ffffff";
    ctx.ellipse(ex, ey, r, r * 1.25, 0, 0, Math.PI * 2);
    ctx.fill();
    if (mood === "scared") {
      ctx.beginPath();
      ctx.fillStyle = OUTLINE;
      ctx.arc(ex + 0.2, ey, 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Polished metal: light on the left, the colour, then dark on the right.
function metalShade(ctx, x0, x1, color) {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, mixColor(color, "#ffffff", 0.55));
  g.addColorStop(0.45, color);
  g.addColorStop(1, mixColor(color, "#000000", 0.35));
  return g;
}

// Eyes glowing through a visor: two bright points, squeezed on a wince,
// arched when happy, wide when scared.
function visorGlow(ctx, spots, color, mood) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = glowBlur(4);
  for (const [x, y] of spots) {
    ctx.beginPath();
    if (mood === "wince" || mood === "happy") {
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.8;
      if (mood === "happy") {
        ctx.moveTo(x - 0.9, y + 0.4);
        ctx.lineTo(x, y - 0.5);
        ctx.lineTo(x + 0.9, y + 0.4);
      } else {
        ctx.moveTo(x - 0.9, y);
        ctx.lineTo(x + 0.9, y);
      }
      ctx.stroke();
      continue;
    }
    const r = mood === "scared" ? 1.1 : 0.85;
    ctx.ellipse(x, y, r * 1.2, r, 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.restore();
}

function flowingCape(ctx, color, top, length, spread, time, stride) {
  const wave = Math.sin(time * 4) * 1.2;
  ctx.beginPath();
  ctx.moveTo(-3.6, top);
  ctx.quadraticCurveTo(-spread - Math.abs(stride) - wave, top + length * 0.45, -spread * 0.8 - Math.abs(stride) + wave, top + length);
  ctx.lineTo(-spread * 0.45, top + length - 1.4);
  ctx.lineTo(-1, top + length * 0.8);
  ctx.closePath();
  inked(ctx, color, 1.2);
}

function plateLegs(ctx, steel, boots, stride, width) {
  for (const side of [-1, 1]) {
    const hip = side * 1.9;
    const foot = side * 3.1 + side * stride * 1.2;
    limb(ctx, hip, -10, foot, -1.6, width, steel);
    inkedCircle(ctx, (hip + foot) / 2, -5.6, width * 0.55, mixColor(steel, "#ffffff", 0.3), 0.7);
    ctx.beginPath();
    ctx.moveTo(foot - 1.8, -2.4);
    ctx.lineTo(foot + 2.2, -2.4);
    ctx.quadraticCurveTo(foot + 3.8, -2, foot + 3.6, 0);
    ctx.lineTo(foot - 1.8, 0);
    ctx.closePath();
    inked(ctx, boots, 0.9);
  }
}

// Recruits: a young squire in a leather jerkin and a nose-guard helmet, a
// scarf flying behind, with a short sword and a round wooden shield.
function drawRecruit(ctx, colors, state, time, stride, swing, mood) {
  const headY = -25;
  const wave = Math.sin(time * 5) * 1.4;
  ctx.beginPath();
  ctx.moveTo(-1, -21);
  ctx.quadraticCurveTo(-7, -21 + wave, -11, -18 - wave);
  ctx.lineTo(-10, -16.4);
  ctx.quadraticCurveTo(-6, -18, -1, -18.6);
  ctx.closePath();
  inked(ctx, colors.tunic, 0.9);
  for (const side of [-1, 1]) {
    const foot = side * 3 + side * stride * 1.2;
    limb(ctx, side * 1.7, -10, foot, -2, 2.3, colors.trim);
    ctx.beginPath();
    ctx.roundRect(foot - 1.8, -2.8, 4.8, 2.8, 1);
    inked(ctx, "#6b4422", 0.9);
  }
  // Round wooden shield on the far arm.
  inkedCircle(ctx, -4.4, -14, 4.2, "#9a5f2c", 1.1);
  ctx.strokeStyle = "#5a3414";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (const x of [-6, -4.4, -2.8]) {
    ctx.moveTo(x, -17.8);
    ctx.lineTo(x, -10.2);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-4.4, -14, 4.2, 0, Math.PI * 2);
  ctx.strokeStyle = colors.helmet;
  ctx.lineWidth = 0.9;
  ctx.stroke();
  inkedCircle(ctx, -4.4, -14, 1.2, colors.helmet, 0.6);
  // Leather jerkin with a stripe of the army's colour, and a belt.
  ctx.beginPath();
  ctx.moveTo(-4.2, -20.4);
  ctx.lineTo(4.4, -20.4);
  ctx.lineTo(3.6, -9.6);
  ctx.lineTo(-3.6, -9.6);
  ctx.closePath();
  inked(ctx, "#8a5a2c");
  ctx.beginPath();
  ctx.rect(-1.2, -20, 2.6, 10);
  ctx.fillStyle = colors.tunic;
  ctx.fill();
  ctx.beginPath();
  ctx.rect(-4, -11.6, 8, 1.8);
  inked(ctx, "#4a2c12", 0.7);
  inkedCircle(ctx, 0.2, -10.7, 0.9, "#ffd23f", 0.5);
  // The face, under a nose-guard helmet.
  inkedCircle(ctx, 0.6, headY, 4.6, colors.skin, 1.2);
  drawCartoonEyes(ctx, 2.2, headY + 0.4, 1.15, true, mood);
  drawSmallMouth(ctx, 2.6, headY + 3.2, mood);
  ctx.beginPath();
  ctx.moveTo(-4.4, headY - 0.6);
  ctx.quadraticCurveTo(-4, headY - 6.6, 0.8, headY - 7.4);
  ctx.quadraticCurveTo(5.6, headY - 6.6, 5.6, headY - 1.2);
  ctx.closePath();
  ctx.fillStyle = metalShade(ctx, -4.4, 5.6, colors.helmet);
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(3.6, headY - 1.6, 1.3, 3.6);
  inked(ctx, colors.helmet, 0.7);
  if (mood === "scared") drawSweatDrop(ctx, -4.6, headY - 1);
  // A short sword, raised.
  weaponArm(ctx, 4.2, -17, swing + 0.9, () => {
    ctx.beginPath();
    ctx.moveTo(2.4, -2);
    ctx.lineTo(2.4, -11);
    ctx.lineTo(3.3, -12.8);
    ctx.lineTo(4.2, -11);
    ctx.lineTo(4.2, -2);
    ctx.closePath();
    inked(ctx, colors.blade, 0.9);
    ctx.beginPath();
    ctx.rect(0.8, -2.6, 5, 1.3);
    inked(ctx, "#6b4422", 0.7);
    inkedCircle(ctx, 3.3, 0.2, 1.8, colors.skin, 0.9);
  });
}

// Knights: full shining plate, a great helm with a glowing visor slit, a tall
// plume, a cape, a kite shield with the gear badge and a longsword.
function drawKnight(ctx, colors, state, time, stride, swing, mood) {
  const steel = colors.helmet;
  const headY = -25.4;
  flowingCape(ctx, colors.cape || mixColor(colors.tunic, "#000000", 0.3), -20.4, 17, 8, time, stride);
  plateLegs(ctx, steel, colors.trim, stride, 2.6);
  // Tabard over the plate, with the badge.
  ctx.beginPath();
  ctx.moveTo(-4.8, -21);
  ctx.lineTo(4.8, -21);
  ctx.lineTo(4, -10);
  ctx.lineTo(-4, -10);
  ctx.closePath();
  ctx.fillStyle = metalShade(ctx, -4.8, 4.8, steel);
  ctx.fill();
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-2.6, -19.6);
  ctx.lineTo(2.8, -19.6);
  ctx.lineTo(3, -7.6);
  ctx.lineTo(0.2, -6.4);
  ctx.lineTo(-2.8, -7.6);
  ctx.closePath();
  inked(ctx, colors.tunic, 1);
  drawGearEmblem(ctx, 0.2, -15, 1.7, colors.blade);
  ctx.beginPath();
  ctx.rect(-4.2, -11.4, 8.4, 1.6);
  inked(ctx, colors.trim, 0.7);
  // Layered shoulder plates.
  for (const [x, w] of [[-4.6, 3], [4.8, 3.2]]) {
    ctx.beginPath();
    ctx.ellipse(x, -20, w, 2.4, 0, Math.PI, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = metalShade(ctx, x - w, x + w, steel);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  }
  // Great helm with a glowing visor slit, and a tall plume.
  if (colors.plume) {
    ctx.beginPath();
    ctx.moveTo(-0.6, headY - 5.6);
    ctx.quadraticCurveTo(-3, headY - 12.4, -9.4, headY - 8.6);
    ctx.quadraticCurveTo(-5, headY - 8.6, -3.4, headY - 4.4);
    ctx.closePath();
    inked(ctx, colors.plume, 1);
  }
  ctx.beginPath();
  ctx.roundRect(-4.2, headY - 5.6, 9.6, 10.6, [3.4, 3.4, 1.4, 1.4]);
  ctx.fillStyle = metalShade(ctx, -4.2, 5.4, steel);
  ctx.fill();
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(-1.6, headY - 1.2, 7, 1.9, 0.8);
  ctx.fillStyle = "#101820";
  ctx.fill();
  ctx.beginPath();
  ctx.rect(2.2, headY + 0.6, 1.1, 3);
  ctx.fill();
  visorGlow(ctx, [[0.8, headY - 0.25], [4, headY - 0.25]], "#8fe7ff", mood);
  if (mood === "scared") drawSweatDrop(ctx, -5.4, headY - 2);
  // Kite shield.
  ctx.beginPath();
  ctx.moveTo(-8.4, -18);
  ctx.lineTo(-2, -18);
  ctx.lineTo(-2, -12.6);
  ctx.quadraticCurveTo(-2.4, -8.4, -5.2, -6.4);
  ctx.quadraticCurveTo(-8, -8.4, -8.4, -12.6);
  ctx.closePath();
  inked(ctx, steel, 1.2);
  ctx.beginPath();
  ctx.moveTo(-7.4, -17);
  ctx.lineTo(-3, -17);
  ctx.lineTo(-3, -12.8);
  ctx.quadraticCurveTo(-3.3, -9.6, -5.2, -8);
  ctx.quadraticCurveTo(-7.1, -9.6, -7.4, -12.8);
  ctx.closePath();
  ctx.fillStyle = colors.tunic;
  ctx.fill();
  drawGearEmblem(ctx, -5.2, -13.2, 1.6, colors.blade);
  // Longsword, raised.
  weaponArm(ctx, 5.4, -17.6, swing + 0.85, () => {
    ctx.beginPath();
    ctx.moveTo(2.5, -2.6);
    ctx.lineTo(2.5, -16);
    ctx.lineTo(3.4, -18.4);
    ctx.lineTo(4.3, -16);
    ctx.lineTo(4.3, -2.6);
    ctx.closePath();
    ctx.fillStyle = metalShade(ctx, 2.5, 4.3, colors.blade);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(-0.2, -3.2, 7.2, 1.5);
    inked(ctx, colors.trim, 0.8);
    inkedCircle(ctx, 3.4, 2.3, 0.9, colors.trim, 0.7);
    inkedCircle(ctx, 3.4, 0.2, 2, steel, 0.9);
  });
}

// Champions: a gold-armoured warlord in a crested helmet with glowing eyes,
// flared shoulder plates, a big red cape and a two-handed greatsword.
function drawChampion(ctx, colors, state, time, stride, swing, mood) {
  const steel = colors.helmet;
  const dark = mixColor(steel, "#000000", 0.45);
  const headY = -25.6;
  flowingCape(ctx, colors.cape || "#b5261a", -21, 19, 10, time, stride);
  plateLegs(ctx, dark, colors.trim, stride, 3);
  // Skirt of armour plates.
  [-4.4, -1.6, 1.2].forEach((x, i) => {
    ctx.beginPath();
    ctx.rect(x, -11.4, 2.8, 4.4);
    inked(ctx, i % 2 ? colors.tunic : steel, 0.8);
  });
  // A broad sculpted breastplate.
  ctx.beginPath();
  ctx.moveTo(-6, -21.4);
  ctx.lineTo(6.4, -21.4);
  ctx.quadraticCurveTo(6, -13, 4.4, -10.8);
  ctx.lineTo(-4.4, -10.8);
  ctx.quadraticCurveTo(-6.2, -13, -6, -21.4);
  ctx.closePath();
  ctx.fillStyle = metalShade(ctx, -6, 6.4, steel);
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.strokeStyle = dark;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-3.4, -17.4);
  ctx.quadraticCurveTo(0.2, -15.8, 3.6, -17.4);
  ctx.moveTo(0.2, -16.4);
  ctx.lineTo(0.2, -11.6);
  ctx.moveTo(-2.4, -13.6);
  ctx.lineTo(2.8, -13.6);
  ctx.stroke();
  // Flared shoulder plates.
  for (const [x, dir] of [[-5.4, -1], [5.6, 1]]) {
    ctx.beginPath();
    ctx.moveTo(x - 3.4, -20.2);
    ctx.quadraticCurveTo(x, -25, x + 3.4, -20.2);
    ctx.lineTo(x + dir * 4.6, -17.6);
    ctx.lineTo(x - dir * 1.4, -18.6);
    ctx.closePath();
    ctx.fillStyle = metalShade(ctx, x - 4, x + 4, steel);
    ctx.fill();
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  }
  // Crested helmet with a glowing T-shaped opening.
  ctx.beginPath();
  ctx.moveTo(-5.4, headY - 3.4);
  ctx.quadraticCurveTo(-2, headY - 15, 6.6, headY - 9.6);
  ctx.lineTo(5.4, headY - 5);
  ctx.quadraticCurveTo(-1, headY - 10.6, -3.4, headY - 2.6);
  ctx.closePath();
  inked(ctx, colors.plume || "#d8432f", 1.1);
  ctx.beginPath();
  ctx.moveTo(-4.4, headY + 5.2);
  ctx.lineTo(-4.6, headY - 2);
  ctx.quadraticCurveTo(-4.4, headY - 6.4, 0.6, headY - 6.6);
  ctx.quadraticCurveTo(5.6, headY - 6.4, 5.6, headY - 1.6);
  ctx.lineTo(6, headY + 3.4);
  ctx.lineTo(3.8, headY + 5.4);
  ctx.closePath();
  ctx.fillStyle = metalShade(ctx, -4.6, 6, steel);
  ctx.fill();
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-0.6, headY - 1.6);
  ctx.lineTo(5.8, headY - 1.6);
  ctx.lineTo(5.8, headY + 0.4);
  ctx.lineTo(3.4, headY + 0.4);
  ctx.lineTo(3.4, headY + 4.4);
  ctx.lineTo(1.8, headY + 4.4);
  ctx.lineTo(1.8, headY + 0.4);
  ctx.lineTo(-0.6, headY + 0.4);
  ctx.closePath();
  ctx.fillStyle = "#1a0d06";
  ctx.fill();
  visorGlow(ctx, [[0.8, headY - 0.6], [4.6, headY - 0.6]], "#ff9a3d", mood);
  if (mood === "scared") drawSweatDrop(ctx, -6, headY - 1);
  // Two-handed greatsword, held high.
  weaponArm(ctx, 5, -16.6, swing + 0.65, () => {
    ctx.beginPath();
    ctx.moveTo(2.1, -3.6);
    ctx.lineTo(2.1, -20);
    ctx.lineTo(3.6, -23);
    ctx.lineTo(5.1, -20);
    ctx.lineTo(5.1, -3.6);
    ctx.closePath();
    ctx.fillStyle = metalShade(ctx, 2.1, 5.1, colors.blade);
    ctx.fill();
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(3.6, -4.4);
    ctx.lineTo(3.6, -19.6);
    ctx.strokeStyle = mixColor(colors.blade, "#000000", 0.25);
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-1.6, -3.4);
    ctx.quadraticCurveTo(3.6, -5.6, 8.8, -3.4);
    ctx.lineTo(8.8, -2.2);
    ctx.lineTo(-1.6, -2.2);
    ctx.closePath();
    inked(ctx, "#ffd23f", 0.8);
    ctx.beginPath();
    ctx.rect(2.8, -2.2, 1.6, 4.4);
    inked(ctx, "#5a3414", 0.6);
    inkedCircle(ctx, 3.6, 3, 1.1, "#ffd23f", 0.6);
    inkedCircle(ctx, 3.6, 0.4, 2.2, steel, 0.9);
  });
}

// Heroes: a radiant paladin in white and gold, a winged helmet with a crown
// and a glowing visor, a halo with light behind, a long cape, a sun shield and
// a glowing blade.
function drawHero(ctx, colors, state, time, stride, swing, mood) {
  const steel = colors.helmet;
  const gold = "#ffd23f";
  const headY = -25.6;
  // Light behind, slowly turning, and a halo.
  ctx.save();
  ctx.translate(0.6, headY);
  ctx.rotate(time * 0.5);
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#fff3a8";
  for (let i = 0; i < 8; i++) {
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-1.6, -13);
    ctx.lineTo(1.6, -13);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0.6, headY - 9.4 + Math.sin(time * 2.4) * 0.5, 4.6, 1.3, 0, 0, Math.PI * 2);
  ctx.strokeStyle = gold;
  ctx.lineWidth = 1.3;
  ctx.shadowColor = gold;
  ctx.shadowBlur = glowBlur(6);
  ctx.stroke();
  ctx.restore();
  flowingCape(ctx, colors.cape || "#3a7ddb", -21, 21, 11, time, stride);
  plateLegs(ctx, steel, gold, stride, 2.7);
  // White breastplate with a sun, gold belt.
  ctx.beginPath();
  ctx.moveTo(-5.4, -21.4);
  ctx.lineTo(5.6, -21.4);
  ctx.lineTo(4.4, -10.4);
  ctx.lineTo(-4.2, -10.4);
  ctx.closePath();
  ctx.fillStyle = metalShade(ctx, -5.4, 5.6, steel);
  ctx.fill();
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.strokeStyle = gold;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.moveTo(0.4 + Math.cos(a) * 1.9, -16 + Math.sin(a) * 1.9);
    ctx.lineTo(0.4 + Math.cos(a) * 3, -16 + Math.sin(a) * 3);
  }
  ctx.stroke();
  inkedCircle(ctx, 0.4, -16, 1.5, gold, 0.6);
  ctx.beginPath();
  ctx.rect(-4.4, -11.8, 8.8, 1.7);
  inked(ctx, gold, 0.7);
  ctx.beginPath();
  ctx.moveTo(-4, -10.2);
  ctx.lineTo(4.2, -10.2);
  ctx.lineTo(5, -6.4);
  ctx.lineTo(-4.8, -6.4);
  ctx.closePath();
  inked(ctx, colors.tunic, 0.9);
  // Winged shoulder plates.
  for (const [x, dir] of [[-5, -1], [5.2, 1]]) {
    ctx.beginPath();
    ctx.moveTo(x - 3, -20.4);
    ctx.quadraticCurveTo(x, -24, x + 3, -20.4);
    ctx.quadraticCurveTo(x + dir * 2, -18.6, x + dir * 4.4, -19.4);
    ctx.quadraticCurveTo(x + dir * 2, -17.4, x - dir * 1, -18.4);
    ctx.closePath();
    ctx.fillStyle = metalShade(ctx, x - 4, x + 4, steel);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  }
  // Winged helmet with a crown and a glowing visor.
  for (const [x, dir, big] of [[-3.8, -1, 1], [4.6, 1, 0.65]]) {
    ctx.beginPath();
    ctx.moveTo(x, headY - 2);
    ctx.quadraticCurveTo(x + dir * 5 * big, headY - 9 * big, x + dir * 8 * big, headY - 6 * big);
    ctx.quadraticCurveTo(x + dir * 5.4 * big, headY - 5 * big, x + dir * 6 * big, headY - 2.6 * big);
    ctx.quadraticCurveTo(x + dir * 3 * big, headY - 2.4, x, headY + 0.6);
    ctx.closePath();
    inked(ctx, "#ffffff", 0.9);
  }
  ctx.beginPath();
  ctx.roundRect(-4, headY - 5.2, 9.2, 10.2, [4, 4, 1.6, 1.6]);
  ctx.fillStyle = metalShade(ctx, -4, 5.2, steel);
  ctx.fill();
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-3.6, headY - 4.4);
  for (const [x, y] of [[-2.4, -7.6], [-1, -4.8], [0.6, -8.4], [2.2, -4.8], [3.6, -7.6], [4.8, -4.4]]) ctx.lineTo(x, headY + y);
  ctx.closePath();
  inked(ctx, gold, 0.8);
  ctx.beginPath();
  ctx.moveTo(-1.4, headY - 1.4);
  ctx.lineTo(5.2, headY - 1.4);
  ctx.lineTo(5.2, headY + 0.4);
  ctx.lineTo(2.6, headY + 0.4);
  ctx.lineTo(2.6, headY + 3.8);
  ctx.lineTo(1.4, headY + 3.8);
  ctx.lineTo(1.4, headY + 0.4);
  ctx.lineTo(-1.4, headY + 0.4);
  ctx.closePath();
  ctx.fillStyle = "#0e1a26";
  ctx.fill();
  visorGlow(ctx, [[0.2, headY - 0.5], [4, headY - 0.5]], "#aef6ff", mood);
  if (mood === "scared") drawSweatDrop(ctx, -6, headY);
  // Round sun shield.
  inkedCircle(ctx, -5, -14, 4.6, gold, 1.2);
  inkedCircle(ctx, -5, -14, 3.3, colors.tunic, 0.8);
  ctx.strokeStyle = gold;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.moveTo(-5 + Math.cos(a) * 1.1, -14 + Math.sin(a) * 1.1);
    ctx.lineTo(-5 + Math.cos(a) * 2.7, -14 + Math.sin(a) * 2.7);
  }
  ctx.stroke();
  inkedCircle(ctx, -5, -14, 0.9, gold, 0.5);
  // The glowing blade.
  weaponArm(ctx, 5.2, -17.6, swing + 0.85, () => {
    ctx.save();
    ctx.shadowColor = colors.blade;
    ctx.shadowBlur = glowBlur(8);
    ctx.beginPath();
    ctx.moveTo(2.2, -2.6);
    ctx.lineTo(2.2, -17);
    ctx.lineTo(3.4, -19.8);
    ctx.lineTo(4.6, -17);
    ctx.lineTo(4.6, -2.6);
    ctx.closePath();
    inked(ctx, colors.blade, 1);
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(3.4, -3.4);
    ctx.lineTo(3.4, -17);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(3.4, -2.4);
    ctx.quadraticCurveTo(0, -1.6, -0.8, -4.6);
    ctx.quadraticCurveTo(1, -3, 3.4, -3.2);
    ctx.quadraticCurveTo(5.8, -3, 7.6, -4.6);
    ctx.quadraticCurveTo(6.8, -1.6, 3.4, -2.4);
    ctx.closePath();
    inked(ctx, gold, 0.8);
    inkedCircle(ctx, 3.4, 2.4, 0.9, gold, 0.7);
    inkedCircle(ctx, 3.4, 0.3, 2.1, steel, 0.9);
  });
}

// Each rank is its own character, not the same knight in new colours.
const KNIGHT_STYLES = { recruit: drawRecruit, knight: drawKnight, champion: drawChampion, hero: drawHero };

// A small gear, the army's badge on tabards and shields.
function drawGearEmblem(ctx, x, y, r, fill) {
  ctx.beginPath();
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    const rr = i % 4 < 2 ? r : r * 0.72;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  inked(ctx, fill, 0.6);
  ctx.beginPath();
  ctx.arc(x, y, r * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
}

// Mixes two #rrggbb colours, `t` of the way from `a` to `b`.
function mixColor(a, b, t) {
  const channel = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const parts = [0, 1, 2].map((i) => Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * t));
  return `#${parts.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// Eyes for the wave monsters: glowing with slit pupils, squeezed shut on a
// wince, squinting with glee, or tiny pupils when scared.
function monsterEyes(ctx, spots, color, mood) {
  for (const [x, y, r] of spots) {
    if (mood === "wince" || mood === "happy") {
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = Math.max(0.7, r * 0.5);
      ctx.beginPath();
      if (mood === "happy") ctx.arc(x, y + r * 0.3, r * 0.8, Math.PI * 1.1, Math.PI * 1.9);
      else {
        ctx.moveTo(x - r * 0.8, y - r * 0.5);
        ctx.lineTo(x + r * 0.6, y);
        ctx.lineTo(x - r * 0.8, y + r * 0.5);
      }
      ctx.stroke();
      continue;
    }
    inkedCircle(ctx, x, y, r, color, 0.6);
    ctx.beginPath();
    ctx.fillStyle = OUTLINE;
    if (mood === "scared") ctx.arc(x + r * 0.2, y, r * 0.3, 0, Math.PI * 2);
    else ctx.ellipse(x + r * 0.25, y, r * 0.3, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// A grin with two fangs, or a small "o" when scared.
function fangMouth(ctx, x, y, w, mood) {
  ctx.beginPath();
  if (mood === "scared") {
    ctx.ellipse(x, y + 0.6, 1, 1.4, 0, 0, Math.PI * 2);
    inked(ctx, "#3a0d06", 0.6);
    return;
  }
  const open = mood === "happy" ? 2.6 : mood === "wince" ? 0.8 : 1.8;
  ctx.moveTo(x - w / 2, y);
  ctx.quadraticCurveTo(x, y + open * 1.6, x + w / 2, y - 0.4);
  ctx.closePath();
  inked(ctx, "#3a0d06", 0.7);
  ctx.fillStyle = "#fff7e0";
  for (const fx of [x - w / 4, x + w / 4]) {
    ctx.beginPath();
    ctx.moveTo(fx - 0.7, y - 0.1);
    ctx.lineTo(fx, y + 1.4);
    ctx.lineTo(fx + 0.7, y - 0.2);
    ctx.fill();
  }
}

// A fuzzy outline, for fur.
function tracePuff(ctx, cx, cy, rx, ry, bumps, depth) {
  ctx.beginPath();
  for (let i = 0; i < bumps * 2; i++) {
    const a = (i / (bumps * 2)) * Math.PI * 2;
    const k = i % 2 ? 1 : 1 - depth;
    const x = cx + Math.cos(a) * rx * k;
    const y = cy + Math.sin(a) * ry * k;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

function limb(ctx, x1, y1, x2, y2, width, fill) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineCap = "round";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = width + 1.6;
  ctx.stroke();
  ctx.strokeStyle = fill;
  ctx.lineWidth = width;
  ctx.stroke();
}

function weaponArm(ctx, x, y, angle, draw) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  draw();
  ctx.restore();
}

// Each wave enemy is its own creature. All face right with their feet on
// y = 0, about 30 units tall, like the knights.
const MONSTER_STYLES = {
  // Goblins: small and green, huge ears, a long nose, a rag and a nail club.
  goblin(ctx, c, state, time, stride, swing, mood) {
    const head = -17;
    for (const side of [-1, 1]) {
      limb(ctx, side * 1.8, -7, side * 2.4 + side * stride, -1.4, 1.8, c.skin);
      ctx.beginPath();
      ctx.ellipse(side * 2.4 + side * stride + 0.8, -1, 2.2, 1.2, 0, 0, Math.PI * 2);
      inked(ctx, "#4a2c12", 0.8);
    }
    ctx.beginPath();
    ctx.ellipse(0, -10.5, 4.4, 4.2, 0, 0, Math.PI * 2);
    inked(ctx, c.skin);
    ctx.beginPath();
    ctx.moveTo(-4.8, -10);
    ctx.lineTo(4.8, -10);
    ctx.lineTo(5, -6);
    ctx.lineTo(3, -4.4);
    ctx.lineTo(1, -6);
    ctx.lineTo(-1, -4.4);
    ctx.lineTo(-3, -6);
    ctx.lineTo(-5, -4.4);
    ctx.closePath();
    inked(ctx, c.tunic, 1.1);
    ctx.beginPath();
    ctx.moveTo(-4, head - 1);
    ctx.lineTo(-14, head - 5);
    ctx.lineTo(-4.4, head + 2.4);
    ctx.closePath();
    inked(ctx, c.skin, 1.1);
    inkedCircle(ctx, 0, head, 6.6, c.skin);
    ctx.beginPath();
    ctx.moveTo(4.6, head - 1);
    ctx.lineTo(10.6, head + 1.6);
    ctx.lineTo(5, head + 2.6);
    ctx.closePath();
    inked(ctx, mixColor(c.skin, "#ffffff", 0.2), 1);
    ctx.beginPath();
    ctx.moveTo(3, head - 5);
    ctx.lineTo(9, head - 10);
    ctx.lineTo(5.6, head - 3.4);
    ctx.closePath();
    inked(ctx, c.skin, 1);
    monsterEyes(ctx, [[0.6, head - 2, 1.8], [4, head - 2.4, 1.5]], "#ffe14d", mood);
    fangMouth(ctx, 2.2, head + 3.4, 5, mood);
    weaponArm(ctx, 3.6, -11, swing + 0.5, () => {
      ctx.beginPath();
      ctx.moveTo(1.6, 1);
      ctx.lineTo(1.2, -7);
      ctx.quadraticCurveTo(3.4, -13.4, 5.6, -7);
      ctx.lineTo(3.6, 1);
      ctx.closePath();
      inked(ctx, c.blade, 1);
      ctx.fillStyle = "#c3ccd5";
      for (const [nx, ny] of [[2, -8], [4.6, -9], [3.4, -11]]) {
        ctx.beginPath();
        ctx.arc(nx, ny, 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      inkedCircle(ctx, 2.6, 1, 1.9, c.skin, 0.9);
    });
  },

  // Goblin runners: a goblin riding a fast, long-legged bird.
  rider(ctx, c, state, time, stride, swing, mood) {
    const run = stride * 2.2;
    for (const [side, phase] of [[-1, 1], [1, -1]]) {
      const kneeX = side * 1.4 + phase * run * 0.5;
      const footX = side * 1.8 + phase * run;
      limb(ctx, side * 1.2, -10, kneeX + 1.6, -5.6, 1.4, "#e0902a");
      limb(ctx, kneeX + 1.6, -5.6, footX, -0.6, 1.4, "#e0902a");
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(footX, -0.6);
      ctx.lineTo(footX + 2.4, 0);
      ctx.moveTo(footX, -0.6);
      ctx.lineTo(footX - 1.4, 0);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-6, -14);
    ctx.lineTo(-11, -18);
    ctx.lineTo(-10, -13);
    ctx.lineTo(-12, -11);
    ctx.lineTo(-6, -11);
    ctx.closePath();
    inked(ctx, c.trim, 1);
    ctx.beginPath();
    ctx.ellipse(0, -12.5, 7, 4.8, 0, 0, Math.PI * 2);
    inked(ctx, c.tunic);
    ctx.beginPath();
    ctx.moveTo(4.4, -14);
    ctx.quadraticCurveTo(7, -17, 8.4, -20.4);
    ctx.lineTo(10.4, -19.4);
    ctx.quadraticCurveTo(9, -15, 6.6, -11.4);
    ctx.closePath();
    inked(ctx, c.tunic, 1.1);
    inkedCircle(ctx, 9.8, -21.4, 2.8, c.tunic, 1.1);
    ctx.beginPath();
    ctx.moveTo(12, -22.4);
    ctx.lineTo(15.6, -21);
    ctx.lineTo(12, -19.8);
    ctx.closePath();
    inked(ctx, "#ff8a3d", 0.8);
    monsterEyes(ctx, [[10.4, -22.2, 1]], "#ffffff", mood === "scared" ? "scared" : "neutral");
    // The rider.
    ctx.beginPath();
    ctx.ellipse(-1, -18.6, 3, 3.6, 0, 0, Math.PI * 2);
    inked(ctx, c.trim, 1);
    ctx.beginPath();
    ctx.moveTo(-2.6, -25);
    ctx.lineTo(-9, -27.4);
    ctx.lineTo(-2.6, -22.6);
    ctx.closePath();
    inked(ctx, c.skin, 0.9);
    inkedCircle(ctx, -0.6, -24.2, 3.8, c.skin, 1.1);
    monsterEyes(ctx, [[0.6, -25, 1.1], [2.8, -25.2, 1]], "#ffe14d", mood);
    fangMouth(ctx, 1.4, -22.4, 3, mood);
    ctx.strokeStyle = "#4a2c12";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(1, -18.4);
    ctx.lineTo(9, -20.4);
    ctx.stroke();
    weaponArm(ctx, 0.6, -19, swing + 0.4, () => {
      ctx.beginPath();
      ctx.moveTo(0.8, -0.6);
      ctx.lineTo(1.6, -7);
      ctx.lineTo(2.6, -0.6);
      ctx.closePath();
      inked(ctx, c.blade, 0.8);
      inkedCircle(ctx, 1.7, 0, 1.3, c.skin, 0.7);
    });
  },

  // Orcs: broad and muscly, a jutting tusked jaw, a topknot and a cleaver.
  orc(ctx, c, state, time, stride, swing, mood) {
    for (const side of [-1, 1]) {
      const x = side * 2.8 + side * stride;
      ctx.beginPath();
      ctx.rect(x - 1.9, -8, 3.8, 6);
      inked(ctx, c.tunic, 1);
      ctx.beginPath();
      ctx.roundRect(x - 2.4, -2.6, 5.4, 2.6, 1);
      inked(ctx, c.trim, 1);
    }
    ctx.beginPath();
    ctx.moveTo(-7.4, -20);
    ctx.lineTo(7.8, -20);
    ctx.lineTo(4.8, -8);
    ctx.lineTo(-4.8, -8);
    ctx.closePath();
    inked(ctx, c.skin);
    ctx.strokeStyle = mixColor(c.skin, "#000000", 0.3);
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(-3, -16.6);
    ctx.quadraticCurveTo(0, -15, 3, -16.6);
    ctx.moveTo(0.4, -15.6);
    ctx.lineTo(0.4, -10.4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-6.6, -19.6);
    ctx.lineTo(-4.2, -19.6);
    ctx.lineTo(4.4, -9);
    ctx.lineTo(2, -9);
    ctx.closePath();
    inked(ctx, c.tunic, 0.8);
    ctx.beginPath();
    ctx.rect(-5.2, -9.4, 10.4, 2.4);
    inked(ctx, c.tunic, 0.9);
    // Spiked shoulder pad.
    for (const sx of [-8, -5.4, -2.8]) {
      ctx.beginPath();
      ctx.moveTo(sx - 1.2, -21);
      ctx.lineTo(sx, -25);
      ctx.lineTo(sx + 1.2, -21);
      ctx.closePath();
      inked(ctx, c.horns, 0.8);
    }
    ctx.beginPath();
    ctx.ellipse(-5.6, -20, 4.2, 2.8, 0, Math.PI, Math.PI * 2);
    ctx.closePath();
    inked(ctx, c.blade, 1);
    // A small head with a big jaw.
    ctx.beginPath();
    ctx.roundRect(-2.6, -28, 9.4, 9.4, 3);
    inked(ctx, c.skin);
    ctx.beginPath();
    ctx.roundRect(-1.4, -22.4, 9.4, 4.6, 2);
    inked(ctx, c.skin, 1.1);
    ctx.fillStyle = "#fff7e0";
    for (const tx of [0.4, 5.6]) {
      ctx.beginPath();
      ctx.moveTo(tx, -22.4);
      ctx.lineTo(tx + 0.8, -25.4);
      ctx.lineTo(tx + 1.8, -22.4);
      ctx.closePath();
      inked(ctx, c.horns, 0.6);
    }
    monsterEyes(ctx, [[1.6, -25.4, 1.1], [4.8, -25.6, 1.1]], "#ff5a3d", mood);
    if (mood !== "happy" && mood !== "scared") {
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-0.4, -27.6);
      ctx.lineTo(6.4, -26.6);
      ctx.stroke();
    }
    inkedCircle(ctx, -0.6, -29.4, 1.8, "#1c1410", 0.8);
    weaponArm(ctx, 6.4, -17, swing + 0.6, () => {
      ctx.beginPath();
      ctx.rect(1.4, -3, 1.8, 5);
      inked(ctx, "#5a3414", 0.8);
      ctx.beginPath();
      ctx.moveTo(0.4, -3);
      ctx.lineTo(0.4, -13);
      ctx.lineTo(6.6, -14);
      ctx.lineTo(6.4, -3);
      ctx.closePath();
      inked(ctx, c.blade, 1);
      inkedCircle(ctx, 4.8, -11.8, 0.8, OUTLINE, 0.3);
      inkedCircle(ctx, 2.3, 1.6, 2.1, c.skin, 0.9);
    });
  },

  // Armoured brutes: a boar-headed brute in iron plate with a spiked flail.
  boar(ctx, c, state, time, stride, swing, mood) {
    for (const side of [-1, 1]) {
      const x = side * 3 + side * stride;
      ctx.beginPath();
      ctx.rect(x - 2, -8, 4, 6);
      inked(ctx, c.trim, 1);
      ctx.beginPath();
      ctx.roundRect(x - 2.6, -2.8, 5.6, 2.8, 1);
      inked(ctx, c.tunic, 1);
    }
    ctx.beginPath();
    ctx.roundRect(-7, -20, 14, 13, 3);
    inked(ctx, c.tunic);
    ctx.fillStyle = OUTLINE;
    for (const [rx, ry] of [[-5, -18], [5, -18], [-5, -9.4], [5, -9.4]]) {
      ctx.beginPath();
      ctx.arc(rx, ry, 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = c.trim;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-6.4, -14);
    ctx.lineTo(6.4, -14);
    ctx.stroke();
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * 6.8, -19.4, 3.6, 2.8, 0, Math.PI, Math.PI * 2);
      ctx.closePath();
      inked(ctx, c.tunic, 1);
    }
    // The boar's head: ears back, a snout, tusks, an iron cap.
    ctx.beginPath();
    ctx.moveTo(-2, -27);
    ctx.lineTo(-7, -30);
    ctx.lineTo(-3, -24);
    ctx.closePath();
    inked(ctx, c.skin, 0.9);
    ctx.beginPath();
    ctx.ellipse(2, -24, 6, 5, 0, 0, Math.PI * 2);
    inked(ctx, c.skin);
    ctx.beginPath();
    ctx.roundRect(6.4, -25.4, 4.6, 4.4, 1.6);
    inked(ctx, mixColor(c.skin, "#f2a0a0", 0.5), 1);
    ctx.fillStyle = OUTLINE;
    for (const ny of [-24.2, -22.2]) {
      ctx.beginPath();
      ctx.ellipse(10, ny, 0.4, 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(6.6, -21.4);
    ctx.quadraticCurveTo(9.6, -21, 10.4, -25.6);
    ctx.quadraticCurveTo(8.6, -23, 6.6, -23);
    ctx.closePath();
    inked(ctx, c.horns, 0.7);
    monsterEyes(ctx, [[3.4, -25.6, 1.1]], "#ff3b1f", mood);
    ctx.beginPath();
    ctx.arc(1.6, -25, 6.2, Math.PI * 1.05, Math.PI * 1.75);
    ctx.lineTo(1.6, -25);
    ctx.closePath();
    inked(ctx, c.horns, 1);
    if (mood === "scared") drawSweatDrop(ctx, -5, -27);
    weaponArm(ctx, 6.6, -16, swing + 0.5, () => {
      ctx.beginPath();
      ctx.rect(1, -6, 1.8, 8);
      inked(ctx, "#5a3414", 0.8);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([1, 1]);
      ctx.beginPath();
      ctx.moveTo(1.9, -6);
      ctx.quadraticCurveTo(5, -9, 4, -12);
      ctx.stroke();
      ctx.setLineDash([]);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(4 + Math.cos(a - 0.4) * 2.6, -14.4 + Math.sin(a - 0.4) * 2.6);
        ctx.lineTo(4 + Math.cos(a) * 4.4, -14.4 + Math.sin(a) * 4.4);
        ctx.lineTo(4 + Math.cos(a + 0.4) * 2.6, -14.4 + Math.sin(a + 0.4) * 2.6);
        ctx.closePath();
        inked(ctx, c.horns, 0.6);
      }
      inkedCircle(ctx, 4, -14.4, 2.8, c.blade, 0.9);
      inkedCircle(ctx, 1.9, 2, 2.2, c.tunic, 0.9);
    });
  },

  // Trolls: huge, hunched and lumpy, with a tiny head and a tree-branch club.
  troll(ctx, c, state, time, stride, swing, mood) {
    for (const side of [-1, 1]) {
      const x = side * 3.6 + side * stride;
      ctx.beginPath();
      ctx.roundRect(x - 2.4, -6, 4.8, 6, 1.8);
      inked(ctx, c.skin, 1.1);
    }
    limb(ctx, -6, -16, -9, -4, 3.2, mixColor(c.skin, "#000000", 0.2));
    ctx.beginPath();
    ctx.moveTo(-9, -6);
    ctx.quadraticCurveTo(-12, -20, -3, -24);
    ctx.quadraticCurveTo(8, -26, 9, -15);
    ctx.quadraticCurveTo(10, -6, 4, -4.4);
    ctx.lineTo(-6, -4.4);
    ctx.closePath();
    inked(ctx, c.skin);
    ctx.fillStyle = "#6f8f45";
    for (const [mx, my, r] of [[-6, -18, 1.8], [-3, -22, 1.4], [-7.6, -11, 1.2]]) {
      ctx.beginPath();
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = mixColor(c.skin, "#000000", 0.2);
    for (const [wx, wy] of [[2, -18], [5, -11], [-2, -13]]) {
      ctx.beginPath();
      ctx.arc(wx, wy, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(-6, -7);
    ctx.lineTo(6, -7);
    ctx.lineTo(5, -3);
    ctx.lineTo(-5, -3);
    ctx.closePath();
    inked(ctx, c.tunic, 1);
    inkedCircle(ctx, 7, -21, 4.2, c.skin, 1.2);
    ctx.beginPath();
    ctx.ellipse(11, -19.6, 2.6, 2, 0.3, 0, Math.PI * 2);
    inked(ctx, mixColor(c.skin, "#ffffff", 0.25), 1);
    monsterEyes(ctx, [[7.6, -22.6, 1], [10, -23, 0.9]], "#ffe14d", mood);
    ctx.fillStyle = c.horns;
    for (const tx of [6.6, 9]) {
      ctx.beginPath();
      ctx.moveTo(tx, -17.6);
      ctx.lineTo(tx + 0.6, -19.4);
      ctx.lineTo(tx + 1.2, -17.6);
      ctx.fill();
    }
    weaponArm(ctx, 6, -15, swing + 0.2, () => {
      ctx.beginPath();
      ctx.moveTo(0.4, 1);
      ctx.lineTo(-0.4, -10);
      ctx.quadraticCurveTo(2.4, -17, 6, -11);
      ctx.lineTo(3.4, 1);
      ctx.closePath();
      inked(ctx, c.blade, 1);
      ctx.beginPath();
      ctx.moveTo(4.6, -9);
      ctx.lineTo(7.6, -10.4);
      ctx.stroke();
      inkedCircle(ctx, 1.9, 1.4, 2.4, c.skin, 1);
    });
  },

  // Frost trolls: a shaggy white yeti with an icy face and an ice club.
  yeti(ctx, c, state, time, stride, swing, mood) {
    for (const side of [-1, 1]) {
      const x = side * 3.4 + side * stride;
      ctx.beginPath();
      ctx.ellipse(x + 0.6, -1.6, 3.4, 1.8, 0, 0, Math.PI * 2);
      inked(ctx, c.skin, 1);
    }
    tracePuff(ctx, 0, -12, 9, 10, 14, 0.12);
    inked(ctx, "#f4fbff");
    tracePuff(ctx, 1.5, -23, 6.4, 5.6, 10, 0.14);
    inked(ctx, "#f4fbff");
    ctx.beginPath();
    ctx.ellipse(3.4, -21.4, 4, 3.6, 0, 0, Math.PI * 2);
    inked(ctx, c.skin, 1);
    monsterEyes(ctx, [[2.2, -22.6, 1.1], [5.2, -22.8, 1]], c.tunic, mood);
    ctx.beginPath();
    if (mood === "scared") {
      ctx.ellipse(4, -19.4, 1, 1.2, 0, 0, Math.PI * 2);
      inked(ctx, "#1d4560", 0.6);
    } else {
      ctx.roundRect(1.6, -20.4, 5, mood === "happy" ? 2.4 : 1.6, 0.6);
      inked(ctx, "#1d4560", 0.7);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(2.2, -20.4, 3.8, 0.7);
    }
    weaponArm(ctx, 6.6, -15, swing + 0.4, () => {
      ctx.beginPath();
      ctx.rect(1.4, -4, 1.8, 6);
      inked(ctx, c.tunic, 0.8);
      ctx.beginPath();
      ctx.moveTo(2.3, -4);
      ctx.lineTo(-1.6, -9);
      ctx.lineTo(0.6, -17);
      ctx.lineTo(3.4, -13);
      ctx.lineTo(5.6, -18);
      ctx.lineTo(6.6, -9);
      ctx.closePath();
      inked(ctx, c.blade, 1);
      tracePuff(ctx, 2.3, 1.4, 2.8, 2.6, 6, 0.2);
      inked(ctx, "#f4fbff", 0.9);
    });
  },

  // Rust shamans: a hooded robe, eyes glowing in the dark, and a staff topped
  // with a spinning rusty gear.
  shaman(ctx, c, state, time, stride, swing, mood) {
    ctx.beginPath();
    ctx.moveTo(-7, 0);
    ctx.quadraticCurveTo(-6, -12, -4, -19);
    ctx.lineTo(5, -19);
    ctx.quadraticCurveTo(7, -10, 7.4, 0);
    for (let x = 7.4; x > -7; x -= 2.4) ctx.lineTo(x - 1.2, x % 2 ? -1.6 : 0);
    ctx.closePath();
    inked(ctx, c.tunic);
    ctx.beginPath();
    ctx.moveTo(-5, -17);
    ctx.quadraticCurveTo(-7, -26, 0, -29);
    ctx.quadraticCurveTo(7, -30, 9, -24);
    ctx.quadraticCurveTo(7, -19, 4.6, -16);
    ctx.closePath();
    inked(ctx, c.tunic);
    ctx.beginPath();
    ctx.ellipse(3.2, -21.6, 3.6, 3.8, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#120a16";
    ctx.fill();
    ctx.save();
    ctx.shadowColor = "#c6ff5a";
    ctx.shadowBlur = glowBlur(4);
    monsterEyes(ctx, [[2.2, -22.2, 0.9], [4.6, -22.4, 0.9]], "#c6ff5a", mood);
    ctx.restore();
    ctx.strokeStyle = c.trim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-5.4, -10);
    ctx.lineTo(6.6, -10);
    ctx.stroke();
    weaponArm(ctx, 5, -13, swing * 0.4 + 0.15, () => {
      ctx.beginPath();
      ctx.rect(1.2, -16, 1.6, 26);
      inked(ctx, "#5a3414", 0.8);
      ctx.save();
      ctx.translate(2, -18.6);
      ctx.rotate(time * 3);
      traceToothedRim(ctx, 4, 2.8, 8);
      inked(ctx, c.horns, 0.9);
      inkedCircle(ctx, 0, 0, 1, "#3a2414", 0.4);
      ctx.restore();
      inkedCircle(ctx, 2, 1.4, 1.8, c.skin, 0.8);
    });
    ctx.fillStyle = c.horns;
    for (let i = 0; i < 3; i++) {
      const a = time * 2 + i * 2.1;
      ctx.fillRect(-1 + Math.cos(a) * 8, -14 + Math.sin(a) * 5, 1.4, 1.4);
    }
  },

  // Demons: big curved horns, bat wings, goat legs, a tail and a trident.
  demon(ctx, c, state, time, stride, swing, mood) {
    const flap = Math.sin(time * 6) * 0.2;
    ctx.save();
    ctx.translate(-2, -19);
    ctx.rotate(-0.2 + flap);
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.lineTo(-3, -11);
    ctx.lineTo(-13, -9);
    ctx.quadraticCurveTo(-10, -6, -10.4, -2.6);
    ctx.quadraticCurveTo(-7, -3.6, -6.4, 0);
    ctx.quadraticCurveTo(-3, -1, 0, 2);
    ctx.closePath();
    inked(ctx, c.tunic, 1.1);
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(-3, -8);
    ctx.quadraticCurveTo(-11, -6 + Math.sin(time * 3) * 2, -12, -14);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = c.skin;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-12, -16.6);
    ctx.lineTo(-10.2, -13.2);
    ctx.lineTo(-13.8, -13.6);
    ctx.closePath();
    inked(ctx, c.skin, 0.8);
    for (const side of [-1, 1]) {
      const x = side * 2.4 + side * stride;
      ctx.beginPath();
      ctx.moveTo(x - 1.6, -9);
      ctx.quadraticCurveTo(x + 2.6, -6, x - 0.4, -3.6);
      ctx.lineTo(x + 0.6, -1.4);
      ctx.lineTo(x + 2.2, -1.4);
      ctx.lineTo(x + 1.4, -4);
      ctx.quadraticCurveTo(x + 4.4, -7, x + 1.6, -9);
      ctx.closePath();
      inked(ctx, mixColor(c.skin, "#000000", 0.25), 1);
      ctx.beginPath();
      ctx.rect(x + 0.2, -1.6, 2.4, 1.6);
      inked(ctx, c.horns, 0.8);
    }
    ctx.beginPath();
    ctx.moveTo(-5.6, -19);
    ctx.lineTo(6, -19);
    ctx.lineTo(3, -8);
    ctx.lineTo(-3, -8);
    ctx.closePath();
    inked(ctx, c.skin);
    ctx.beginPath();
    ctx.rect(-3.4, -10, 6.8, 2.6);
    inked(ctx, c.tunic, 0.8);
    for (const [hx, dir] of [[-2.2, -1], [3.6, 1]]) {
      ctx.beginPath();
      ctx.moveTo(hx, -26);
      ctx.quadraticCurveTo(hx + dir * 4, -30, hx + dir * 2, -33.4);
      ctx.quadraticCurveTo(hx + dir * 2.4, -29.6, hx + dir * -1.4, -27.4);
      ctx.closePath();
      inked(ctx, c.horns, 0.9);
    }
    inkedCircle(ctx, 1, -23, 5.6, c.skin);
    monsterEyes(ctx, [[0.2, -24, 1.3], [3.8, -24.2, 1.2]], "#ffe14d", mood);
    fangMouth(ctx, 2.2, -20.4, 4.4, mood);
    weaponArm(ctx, 5.4, -16, swing + 0.5, () => {
      ctx.beginPath();
      ctx.rect(1.4, -14, 1.6, 20);
      inked(ctx, "#2a1020", 0.8);
      ctx.save();
      ctx.shadowColor = c.blade;
      ctx.shadowBlur = glowBlur(5);
      ctx.beginPath();
      ctx.moveTo(-1.6, -13);
      ctx.lineTo(-1.6, -17);
      ctx.moveTo(2.2, -13);
      ctx.lineTo(2.2, -19);
      ctx.moveTo(6, -13);
      ctx.lineTo(6, -17);
      ctx.moveTo(-1.6, -13);
      ctx.lineTo(6, -13);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.strokeStyle = c.blade;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
      inkedCircle(ctx, 2.2, 1, 2, c.skin, 0.9);
    });
  },

  // Fire imps: a little floating flame with a face, wings and a fireball.
  imp(ctx, c, state, time, stride, swing, mood) {
    const bob = Math.sin(time * 6) * 1.4;
    ctx.save();
    ctx.translate(0, -4 + bob);
    ctx.beginPath();
    ctx.ellipse(0, 4, 5, 1.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
    ctx.fill();
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * 3, -12);
      ctx.lineTo(side * 11, -17 + Math.sin(time * 14) * 2);
      ctx.lineTo(side * 9, -10);
      ctx.lineTo(side * 4, -9);
      ctx.closePath();
      inked(ctx, c.tunic, 0.9);
    }
    const lick = Math.sin(time * 11);
    ctx.beginPath();
    ctx.moveTo(-6, -6);
    ctx.quadraticCurveTo(-7, -14, -3, -18 + lick);
    ctx.quadraticCurveTo(-2, -14, 0, -15);
    ctx.quadraticCurveTo(0, -21, 3, -24 - lick);
    ctx.quadraticCurveTo(3.4, -18, 5, -17);
    ctx.quadraticCurveTo(8, -12, 6, -5);
    ctx.quadraticCurveTo(3, 1, 0, 1);
    ctx.quadraticCurveTo(-4, 1, -6, -6);
    ctx.closePath();
    inked(ctx, c.skin);
    ctx.beginPath();
    ctx.moveTo(-3.6, -5);
    ctx.quadraticCurveTo(-3.6, -10, 0, -13);
    ctx.quadraticCurveTo(0.6, -9, 3, -10);
    ctx.quadraticCurveTo(4.4, -5, 1, -1.6);
    ctx.quadraticCurveTo(-2.6, -1.6, -3.6, -5);
    ctx.closePath();
    ctx.fillStyle = "#ffe14d";
    ctx.fill();
    for (const hx of [-2.6, 3]) {
      ctx.beginPath();
      ctx.moveTo(hx - 1, -14);
      ctx.lineTo(hx, -17.6);
      ctx.lineTo(hx + 1, -14);
      ctx.closePath();
      inked(ctx, c.horns, 0.7);
    }
    monsterEyes(ctx, [[-0.6, -9, 1.2], [2.6, -9.2, 1.1]], "#ffffff", mood);
    fangMouth(ctx, 1, -5.6, 3.6, mood);
    weaponArm(ctx, 5, -6, swing + 0.4, () => {
      ctx.save();
      ctx.shadowColor = c.blade;
      ctx.shadowBlur = glowBlur(6);
      inkedCircle(ctx, 1.4, -4, 2.6, c.blade, 0.8);
      ctx.restore();
      inkedCircle(ctx, 1.4, 0.4, 1.2, c.skin, 0.6);
    });
    ctx.restore();
  },
};


function drawBombIcon(ctx, x, y) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 4, y - 6);
  ctx.quadraticCurveTo(x + 7, y - 11, x + 10, y - 9);
  ctx.stroke();
  inkedCircle(ctx, x, y, 7.5, "#3a3a44", 1.6);
  ctx.beginPath();
  ctx.fillStyle = "#ffffff";
  ctx.ellipse(x - 2.6, y - 2.8, 1.8, 2.6, 0.6, 0, Math.PI * 2);
  ctx.fill();
  const flicker = 2.6 + Math.sin(performance.now() / 50);
  inkedCircle(ctx, x + 10.5, y - 9.5, flicker, "#ffcc33", 1);
  ctx.restore();
}

// Each army is shown as one big fighter at the front line, its size growing a
// little with rank. The number above says how many soldiers it stands for.
function fighterScale(look) {
  return 1.2 * (1 + (SOLDIER_LOOKS[look].size - 1) * 0.4) / SOLDIER_LOOKS[look].size;
}

// Where the top of a fighter's head is, so its number can sit just above it.
function fighterTop(look, feetY) {
  return feetY - 31 * fighterScale(look) * SOLDIER_LOOKS[look].size * battleArtScale();
}

function drawArmyFighter(ctx, x, feetY, look, facing, state, mood) {
  const scale = fighterScale(look);
  ctx.save();
  ctx.translate(x, feetY);
  ctx.scale(scale, scale);
  drawSoldier(ctx, 0, 0, facing, look, state, facing, mood);
  ctx.restore();
}

// A soldier drawn once and reused, because a crowd is drawn every frame.
function crowdSprite(look, facing) {
  const scale = canvasScale();
  const key = `${look}:${facing}:${scale}:${battleArtScale()}`;
  let sprite = crowdSprites.get(key);
  if (!sprite) {
    sprite = document.createElement("canvas");
    sprite.width = sprite.height = Math.ceil(CROWD_SPRITE_SIZE * scale);
    const ctx = sprite.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawSoldier(ctx, CROWD_SPRITE_SIZE / 2, CROWD_SPRITE_SIZE - 4, facing, look, "idle", 0);
    crowdSprites.set(key, sprite);
  }
  return sprite;
}

// The army behind a fighter, growing with its size. Doubling the army adds one
// soldier, so a crowd keeps growing for the whole run without filling the lane.
function drawCrowd(ctx, frontX, edgeX, away, firstGap, look, count, groundY, cheering) {
  const size = Math.min(CROWD_MAX, Math.floor(Math.log2(1 + Math.max(0, count))));
  const sprite = crowdSprite(look, -away);
  const drawn = CROWD_SPRITE_SIZE * CROWD_SCALE;
  const time = performance.now() / 1000;
  // Farthest first, so nearer soldiers overlap them.
  for (let i = size - 1; i >= 0; i--) {
    const x = frontX + away * (firstGap + i * CROWD_SPACING);
    if ((x - edgeX) * away > 0) continue;
    const bob = Math.abs(Math.sin(time * (cheering ? 8 : 4) + i * 1.7)) * (cheering ? 6 : 1.5);
    const feetY = groundY - (i % 2 ? 5 : 0) - bob;
    ctx.drawImage(sprite, x - drawn / 2, feetY - drawn + 4 * CROWD_SCALE, drawn, drawn);
  }
}

// Big numbers are shortened so the two counts never run into each other.
function shortNumber(value) {
  if (value >= 1000000) return `${Math.round(value / 100000) / 10}M`;
  if (value >= 10000) return `${Math.round(value / 1000)}K`;
  return String(value);
}

function drawArmyCount(ctx, x, y, count) {
  ctx.font = "800 16px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  drawLaneText(ctx, shortNumber(count), x, y);
}

// The boss stands just past the front line, glowing before each attack, and
// flashes when soldiers hit it.
const BOSS_DROP_SECONDS = 1.1; // the warning siren plays while the boss falls in
const BOSS_DROP_HEIGHT = 140; // pixels above the ground the boss falls from
const BOSS_LAND_SHAKE = 9; // pixels

// Each boss is its own creature, not a wave monster in a hat. All are drawn
// facing right with their feet on y = 0, about 55 pixels tall. `swing` winds
// the weapon arm back before an attack.
function bossColors(body) {
  return { body, dark: mixColor(body, "#000000", 0.4), light: mixColor(body, "#ffffff", 0.35) };
}

function glowEye(ctx, x, y, rx, ry, color) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = glowBlur(5);
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function bossArm(ctx, x, y, swing, draw) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(swing);
  draw();
  ctx.restore();
}

const BOSS_BODIES = {
  // A boxy robot king of rusted iron, with a crown and a scepter.
  rust(ctx, c, time, swing) {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.roundRect(side * 7 - 4, -11, 8, 11, 2);
      inked(ctx, c.dark, 1.8);
    }
    bossArm(ctx, -14, -34, 0.25, () => {
      ctx.beginPath();
      ctx.roundRect(-3, 0, 6, 16, 2);
      inked(ctx, c.dark, 1.6);
    });
    ctx.beginPath();
    ctx.roundRect(-14, -40, 28, 31, 4);
    inked(ctx, c.body, 2.2);
    ctx.fillStyle = "rgba(255, 140, 60, 0.35)";
    for (const [x, y, r] of [[-7, -30, 4], [5, -18, 3], [8, -34, 2.4]]) {
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.3, r, 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = OUTLINE;
    for (const x of [-11, 11]) for (const y of [-36, -26, -14]) {
      ctx.beginPath();
      ctx.arc(x, y, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.roundRect(-9, -53, 18, 14, 3);
    inked(ctx, c.body, 2);
    glowEye(ctx, 1.5, -46, 2.4, 1, "#ffb03d");
    glowEye(ctx, 6.5, -46, 2.4, 1, "#ffb03d");
    ctx.beginPath();
    ctx.moveTo(-9, -52);
    ctx.lineTo(-10, -61);
    ctx.lineTo(-4.5, -56);
    ctx.lineTo(0, -63);
    ctx.lineTo(4.5, -56);
    ctx.lineTo(10, -61);
    ctx.lineTo(9, -52);
    ctx.closePath();
    inked(ctx, "#f2c23e", 1.8);
    bossArm(ctx, 14, -32, swing, () => {
      ctx.beginPath();
      ctx.rect(-1.4, -26, 3, 28);
      inked(ctx, "#5a3414", 1.4);
      inkedCircle(ctx, 0, -28, 4.4, "#f2c23e", 1.6);
      inkedCircle(ctx, 0, -28, 1.6, "#d8432f", 0.8);
      inkedCircle(ctx, 0, 2, 3.6, c.body, 1.6);
    });
  },

  // A golem built from bricks, with one big eye and a mason's trowel.
  wall(ctx, c, time, swing) {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.rect(side * 7 - 4.5, -10, 9, 10);
      inked(ctx, c.dark, 1.8);
    }
    ctx.beginPath();
    ctx.roundRect(-15, -41, 30, 33, 3);
    inked(ctx, c.body, 2.2);
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let row = 0; row < 5; row++) {
      const y = -41 + row * 6.6;
      if (row) {
        ctx.moveTo(-15, y);
        ctx.lineTo(15, y);
      }
      for (let x = row % 2 ? -10 : -5; x < 15; x += 10) {
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 6.6);
      }
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(-8, -53, 16, 13, 3);
    inked(ctx, c.body, 2);
    inkedCircle(ctx, 2, -47, 4, "#fff7e0", 1.4);
    inkedCircle(ctx, 3.2, -47, 1.8, OUTLINE, 0.5);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-3, -53);
    ctx.lineTo(8, -50.5);
    ctx.stroke();
    for (const [bx, by] of [[-9, -59], [1, -59], [-4, -64]]) {
      ctx.beginPath();
      ctx.rect(bx, by, 10, 5.4);
      inked(ctx, "#c98560", 1.4);
    }
    bossArm(ctx, 15, -30, swing, () => {
      ctx.beginPath();
      ctx.rect(-1.4, -14, 2.8, 16);
      inked(ctx, "#5a3414", 1.2);
      ctx.beginPath();
      ctx.moveTo(-6, -14);
      ctx.lineTo(6, -14);
      ctx.lineTo(0, -27);
      ctx.closePath();
      inked(ctx, "#c3ccd5", 1.4);
      ctx.beginPath();
      ctx.roundRect(-4, -1, 8, 6, 2);
      inked(ctx, c.body, 1.4);
    });
  },

  // A mad robot on one wheel, with goggles and a spinning gear on its antenna.
  scramble(ctx, c, time, swing) {
    ctx.save();
    ctx.translate(0, -8);
    ctx.rotate(time * 5);
    inkedCircle(ctx, 0, 0, 8, "#3b3f46", 1.8);
    ctx.strokeStyle = "#c3ccd5";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      ctx.moveTo(Math.cos(a) * 6, Math.sin(a) * 6);
      ctx.lineTo(-Math.cos(a) * 6, -Math.sin(a) * 6);
    }
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.rect(-2.4, -20, 4.8, 9);
    inked(ctx, "#8d99a6", 1.4);
    ctx.beginPath();
    ctx.ellipse(0, -32, 14, 13, 0, 0, Math.PI * 2);
    inked(ctx, c.body, 2.2);
    ctx.beginPath();
    ctx.ellipse(0, -36, 10, 7, 0, Math.PI, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = "rgba(200, 245, 255, 0.45)";
    ctx.fill();
    for (const x of [2.5, 9]) {
      inkedCircle(ctx, x, -31, 3.6, "#ffcc33", 1.4);
      inkedCircle(ctx, x, -31, 2.3, "#8fe7ff", 0.8);
      ctx.beginPath();
      ctx.arc(x, -31, 1.2, time * 8, time * 8 + Math.PI * 1.4);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, -45);
    ctx.lineTo(0, -52);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.save();
    ctx.translate(0, -56);
    ctx.rotate(time * 4);
    traceToothedRim(ctx, 6.5, 4.6, 8);
    inked(ctx, "#8fe7ff", 1.4);
    inkedCircle(ctx, 0, 0, 1.8, c.dark, 1);
    ctx.restore();
    bossArm(ctx, 13, -30, swing, () => {
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (let i = 1; i <= 6; i++) ctx.lineTo(i % 2 ? 3 : -3, -i * 2.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.rect(-1.2, -26, 2.4, 10);
      inked(ctx, "#c3ccd5", 1.2);
      ctx.beginPath();
      ctx.arc(0, -27, 3.6, Math.PI * 0.2, Math.PI * 1.8);
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = "#c3ccd5";
      ctx.stroke();
    });
  },

  // A hulking brute behind a giant tower shield, a spiked mace over the top.
  shield(ctx, c, time, swing) {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.roundRect(side * 7 - 5, -11, 10, 11, 2);
      inked(ctx, c.dark, 1.8);
    }
    ctx.beginPath();
    ctx.ellipse(-3, -27, 14, 17, 0, 0, Math.PI * 2);
    inked(ctx, c.body, 2.2);
    bossArm(ctx, -8, -38, swing - 0.4, () => {
      ctx.beginPath();
      ctx.rect(-1.6, -22, 3.2, 24);
      inked(ctx, "#5a3414", 1.4);
      inkedCircle(ctx, 0, -24, 5.6, "#59606b", 1.6);
      ctx.fillStyle = "#c3ccd5";
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a - 0.3) * 5, -24 + Math.sin(a - 0.3) * 5);
        ctx.lineTo(Math.cos(a) * 9, -24 + Math.sin(a) * 9);
        ctx.lineTo(Math.cos(a + 0.3) * 5, -24 + Math.sin(a + 0.3) * 5);
        ctx.closePath();
        inked(ctx, "#c3ccd5", 1);
      }
    });
    inkedCircle(ctx, -2, -47, 8, "#c3ccd5", 2);
    ctx.beginPath();
    ctx.rect(-4, -55, 4, 9);
    inked(ctx, "#8d99a6", 1.2);
    ctx.beginPath();
    ctx.roundRect(-1, -49.5, 9, 3.4, 1.2);
    inked(ctx, "#1c1410", 1);
    glowEye(ctx, 2, -47.8, 1.3, 1, "#ff3b1f");
    glowEye(ctx, 6, -47.8, 1.3, 1, "#ff3b1f");
    ctx.beginPath();
    ctx.roundRect(1, -44, 14, 43, 3);
    inked(ctx, "#8d99a6", 2.4);
    ctx.beginPath();
    ctx.roundRect(3.4, -41.5, 9.2, 38, 2);
    ctx.strokeStyle = "#c3ccd5";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(6.8, -38, 2.4, 31);
    ctx.rect(3.4, -26, 9.2, 2.4);
    ctx.fillStyle = "#59606b";
    ctx.fill();
    ctx.fillStyle = OUTLINE;
    for (const [x, y] of [[4.5, -40], [11.5, -40], [4.5, -5], [11.5, -5]]) {
      ctx.beginPath();
      ctx.arc(x, y, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  // A huge goblin with a fur cape, a horned helmet and a great axe.
  warlord(ctx, c, time, swing) {
    ctx.beginPath();
    ctx.moveTo(-6, -36);
    ctx.quadraticCurveTo(-20, -20, -16, -2);
    ctx.lineTo(-2, -8);
    ctx.closePath();
    inked(ctx, "#7a4a23", 1.8);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.rect(side * 5 - 2.4, -12, 4.8, 9);
      inked(ctx, c.body, 1.6);
      ctx.beginPath();
      ctx.roundRect(side * 5 - 3.6, -4, 8, 4, 1.4);
      inked(ctx, "#4a2c12", 1.6);
    }
    ctx.beginPath();
    ctx.ellipse(1, -24, 12, 13, 0, 0, Math.PI * 2);
    inked(ctx, c.body, 2.2);
    ctx.beginPath();
    ctx.moveTo(-9, -32);
    ctx.lineTo(-5, -16);
    ctx.lineTo(-11, -20);
    ctx.closePath();
    inked(ctx, "#5a3414", 1.4);
    ctx.beginPath();
    ctx.rect(-10, -16, 22, 3.6);
    inked(ctx, "#4a2c12", 1.4);
    inkedCircle(ctx, 3, -14.2, 2.6, "#f3ead2", 1.2);
    // Head: long ears, a big nose, a tusky grin.
    for (const [x, tip] of [[-6, -18], [8, 18]]) {
      ctx.beginPath();
      ctx.moveTo(x, -46);
      ctx.lineTo(x + tip, -51);
      ctx.lineTo(x, -40);
      ctx.closePath();
      inked(ctx, c.body, 1.6);
    }
    inkedCircle(ctx, 2, -44, 9.5, c.body, 2);
    ctx.beginPath();
    ctx.moveTo(7, -46);
    ctx.lineTo(15, -42);
    ctx.lineTo(7, -40);
    ctx.closePath();
    inked(ctx, c.light, 1.4);
    glowEye(ctx, 2, -47, 1.8, 1.4, "#ffe14d");
    glowEye(ctx, 7.4, -47, 1.6, 1.3, "#ffe14d");
    ctx.beginPath();
    ctx.moveTo(-1, -38);
    ctx.quadraticCurveTo(5, -34, 10, -38);
    ctx.closePath();
    inked(ctx, "#3a0d06", 1.2);
    ctx.fillStyle = "#fff7e0";
    for (const x of [1, 7]) {
      ctx.beginPath();
      ctx.moveTo(x - 1.2, -37.6);
      ctx.lineTo(x, -40.6);
      ctx.lineTo(x + 1.2, -37.6);
      ctx.fill();
    }
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * 6, -52);
      ctx.quadraticCurveTo(side * 18, -54, side * 17, -66);
      ctx.quadraticCurveTo(side * 12, -58, side * 2, -57);
      ctx.closePath();
      inked(ctx, "#f3ead2", 1.5);
    }
    ctx.beginPath();
    ctx.arc(2, -48, 10.4, Math.PI * 1.08, Math.PI * 1.92);
    ctx.closePath();
    inked(ctx, "#7a4a23", 1.8);
    bossArm(ctx, 12, -28, swing, () => {
      ctx.beginPath();
      ctx.rect(-1.5, -30, 3, 33);
      inked(ctx, "#5a3414", 1.4);
      ctx.beginPath();
      ctx.moveTo(1.5, -29);
      ctx.quadraticCurveTo(13, -33, 11, -18);
      ctx.quadraticCurveTo(6, -22, 1.5, -20);
      ctx.closePath();
      inked(ctx, "#c3ccd5", 1.6);
      ctx.beginPath();
      ctx.moveTo(-1.5, -29);
      ctx.quadraticCurveTo(-11, -32, -9, -20);
      ctx.quadraticCurveTo(-5, -23, -1.5, -21);
      ctx.closePath();
      inked(ctx, "#c3ccd5", 1.6);
      inkedCircle(ctx, 0, 2, 3.6, c.body, 1.6);
    });
  },

  // A giant segmented worm rising out of a mound of sand.
  wyrm(ctx, c, time, swing) {
    const sway = Math.sin(time * 2.2) * 2;
    ctx.beginPath();
    ctx.ellipse(0, -2, 22, 5.5, 0, 0, Math.PI * 2);
    inked(ctx, "#e0c07a", 1.8);
    const segments = [[-6, -6, 9.5], [-6, -14, 9.2], [-4, -22, 9], [-1, -30, 8.8], [2, -37, 8.6]];
    segments.forEach(([x, y, r], i) => {
      const sx = x + sway * (i / segments.length);
      for (const t of [-0.5, 0, 0.5]) {
        const a = -Math.PI / 2 + Math.PI + t;
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(a - 0.12) * r * 0.9, y + Math.sin(a - 0.12) * r * 0.9);
        ctx.lineTo(sx + Math.cos(a) * (r + 5), y + Math.sin(a) * (r + 5));
        ctx.lineTo(sx + Math.cos(a + 0.12) * r * 0.9, y + Math.sin(a + 0.12) * r * 0.9);
        ctx.closePath();
        inked(ctx, "#6b3f17", 1.2);
      }
      inkedCircle(ctx, sx, y, r, i % 2 ? c.body : c.light, 2);
    });
    ctx.save();
    ctx.translate(4 + sway, -48);
    ctx.rotate(-swing * 0.25 - 0.1);
    inkedCircle(ctx, 0, 0, 11.5, c.body, 2.2);
    for (const [x, tall] of [[-8, 7], [-3, 10], [2, 8]]) {
      ctx.beginPath();
      ctx.moveTo(x - 3, -9);
      ctx.lineTo(x - 1, -9 - tall);
      ctx.lineTo(x + 3, -10);
      ctx.closePath();
      inked(ctx, "#6b3f17", 1.3);
    }
    inkedCircle(ctx, 6, 1, 7, "#3a0d06", 1.6);
    ctx.fillStyle = "#fff7e0";
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(6 + Math.cos(a - 0.25) * 6.6, 1 + Math.sin(a - 0.25) * 6.6);
      ctx.lineTo(6 + Math.cos(a) * 3.4, 1 + Math.sin(a) * 3.4);
      ctx.lineTo(6 + Math.cos(a + 0.25) * 6.6, 1 + Math.sin(a + 0.25) * 6.6);
      ctx.fill();
    }
    glowEye(ctx, -2, -5, 1.6, 1.6, "#ff7a3d");
    glowEye(ctx, 4, -7.5, 1.4, 1.4, "#ff7a3d");
    ctx.restore();
  },

  // A tall ice sorceress with a bell gown, an ice crown and a crystal staff.
  queen(ctx, c, time, swing) {
    ctx.beginPath();
    ctx.moveTo(-3, -46);
    ctx.quadraticCurveTo(-16, -30, -12, -12);
    ctx.lineTo(-4, -20);
    ctx.closePath();
    inked(ctx, "#f2fbff", 1.6);
    ctx.beginPath();
    ctx.moveTo(-15, 0);
    ctx.quadraticCurveTo(-7, -18, -5.5, -31);
    ctx.lineTo(5.5, -31);
    ctx.quadraticCurveTo(7, -18, 15, 0);
    ctx.closePath();
    inked(ctx, c.body, 2.2);
    ctx.beginPath();
    ctx.moveTo(-15, 0);
    for (let x = -15; x <= 15; x += 3) ctx.lineTo(x + 1.5, x % 2 ? -4.5 : -2);
    ctx.lineTo(15, 0);
    ctx.closePath();
    inked(ctx, "#bdeeff", 1.2);
    ctx.beginPath();
    ctx.roundRect(-5, -39, 10, 9, 2);
    inked(ctx, c.light, 1.6);
    inkedCircle(ctx, 1, -45, 6.4, "#dff3ff", 1.8);
    glowEye(ctx, 1, -45.5, 1, 1.3, "#3f7fc0");
    glowEye(ctx, 5, -45.5, 1, 1.3, "#3f7fc0");
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(1.5, -42);
    ctx.lineTo(4.5, -42.4);
    ctx.stroke();
    for (const [sx, tall, lean] of [[-5, 6, -2], [-2, 9, -1], [1, 12, 0], [4, 9, 1], [7, 6, 2]]) {
      ctx.beginPath();
      ctx.moveTo(sx - 2, -50);
      ctx.lineTo(sx + lean, -50 - tall);
      ctx.lineTo(sx + 2, -50);
      ctx.closePath();
      inked(ctx, "#bdeeff", 1.2);
    }
    bossArm(ctx, 7, -34, swing, () => {
      ctx.beginPath();
      ctx.rect(-1, -26, 2, 34);
      inked(ctx, "#d8f6ff", 1.2);
      ctx.save();
      ctx.shadowColor = "#bdeeff";
      ctx.shadowBlur = glowBlur(8);
      ctx.beginPath();
      ctx.moveTo(0, -36);
      ctx.lineTo(4, -29);
      ctx.lineTo(0, -24);
      ctx.lineTo(-4, -29);
      ctx.closePath();
      inked(ctx, "#bdeeff", 1.4);
      ctx.restore();
      inkedCircle(ctx, 0, 0, 2.4, "#dff3ff", 1.2);
    });
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 4; i++) {
      const fx = -16 + ((time * 6 + i * 11) % 34);
      const fy = -54 + ((time * 9 + i * 17) % 50);
      ctx.beginPath();
      ctx.arc(fx, fy, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  // A rock giant with glowing lava cracks, a flaming crown and a molten fist.
  magma(ctx, c, time, swing) {
    const rock = mixColor(c.body, "#000000", 0.62);
    const glow = 0.6 + Math.sin(time * 5) * 0.4;
    const lava = `rgba(255, ${140 + Math.round(glow * 60)}, 50, 1)`;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * 3, 0);
      ctx.lineTo(side * 3, -12);
      ctx.lineTo(side * 12, -10);
      ctx.lineTo(side * 11, 0);
      ctx.closePath();
      inked(ctx, rock, 1.8);
    }
    ctx.beginPath();
    ctx.moveTo(-15, -12);
    ctx.lineTo(-17, -30);
    ctx.lineTo(-10, -42);
    ctx.lineTo(6, -44);
    ctx.lineTo(16, -34);
    ctx.lineTo(14, -14);
    ctx.lineTo(4, -8);
    ctx.closePath();
    inked(ctx, rock, 2.2);
    ctx.save();
    ctx.shadowColor = "#ff8a3d";
    ctx.shadowBlur = glowBlur(6);
    ctx.strokeStyle = lava;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-10, -36);
    ctx.lineTo(-4, -28);
    ctx.lineTo(-8, -20);
    ctx.moveTo(-4, -28);
    ctx.lineTo(4, -26);
    ctx.lineTo(8, -16);
    ctx.moveTo(4, -26);
    ctx.lineTo(10, -36);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(-7, -42);
    ctx.lineTo(-8, -54);
    ctx.lineTo(8, -56);
    ctx.lineTo(10, -43);
    ctx.closePath();
    inked(ctx, rock, 2);
    glowEye(ctx, 1, -49, 1.8, 1.3, "#ffe14d");
    glowEye(ctx, 6, -49, 1.6, 1.2, "#ffe14d");
    const lick = Math.sin(time * 9) * 2;
    ctx.beginPath();
    ctx.moveTo(-8, -54);
    ctx.quadraticCurveTo(-10, -62, -5, -65 + lick);
    ctx.quadraticCurveTo(-3, -60, -1, -61);
    ctx.quadraticCurveTo(0, -69, 4, -72 - lick);
    ctx.quadraticCurveTo(5, -63, 7, -63);
    ctx.quadraticCurveTo(9, -66, 11, -65 + lick);
    ctx.quadraticCurveTo(12, -59, 8, -56);
    ctx.closePath();
    inked(ctx, "#ff8a3d", 1.4);
    ctx.beginPath();
    ctx.moveTo(-3, -55);
    ctx.quadraticCurveTo(-3, -61, 1, -63);
    ctx.quadraticCurveTo(3, -59, 5, -61);
    ctx.quadraticCurveTo(7, -58, 5, -55);
    ctx.closePath();
    ctx.fillStyle = "#ffe14d";
    ctx.fill();
    for (const [x, y] of [[-12, -10], [12, -12]]) {
      const drip = (time * 1.4 + x) % 1;
      ctx.beginPath();
      ctx.ellipse(x, y + drip * 8, 1.4, 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = lava;
      ctx.fill();
    }
    bossArm(ctx, 13, -32, swing, () => {
      ctx.beginPath();
      ctx.moveTo(-3, 0);
      ctx.lineTo(-4, -14);
      ctx.lineTo(4, -15);
      ctx.lineTo(3, 0);
      ctx.closePath();
      inked(ctx, rock, 1.6);
      ctx.save();
      ctx.shadowColor = "#ff8a3d";
      ctx.shadowBlur = glowBlur(8);
      inkedCircle(ctx, 0, -18, 6, lava, 1.8);
      ctx.restore();
    });
  },
};

function drawBoss(ctx, who, markerX, x1, feetY) {
  const x = Math.min(x1 - 22, markerX + 32);
  const warning = who.attackIn < BOSS_WARNING_SECONDS;
  const time = performance.now() / 1000;
  const body = who.hitFlash > 0 ? "#ffffff" : who.kind.color;
  const armSwing = warning ? -1.7 + Math.sin(time * 18) * 0.15 : -0.5 + Math.sin(time * 4) * 0.4;
  const breathe = Math.sin(time * 3) * 0.03;
  ctx.save();
  const fall = 1 - (who.enter ?? 1);
  ctx.translate(x, feetY - fall * fall * BOSS_DROP_HEIGHT);
  const size = who.kind.final ? FINAL_BOSS_DRAW_SCALE : 1;
  ctx.scale(size * (1 - breathe), size * (1 + breathe + (warning ? 0.05 : 0)));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (warning) {
    ctx.shadowColor = "#ff3b1f";
    ctx.shadowBlur = glowBlur(16);
  }

  // Drawn facing right, then turned to face the player's army.
  ctx.scale(-1, 1);
  (BOSS_BODIES[who.kind.id] || BOSS_BODIES.rust)(ctx, bossColors(body), time, armSwing);
  ctx.restore();
  if (who.shield > 0) {
    const y = feetY - 25;
    ctx.beginPath();
    ctx.fillStyle = "rgba(10, 40, 60, 0.8)";
    ctx.arc(x, y, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#8fe7ff";
    ctx.stroke();
    ctx.font = "800 12px system-ui, sans-serif";
    ctx.fillStyle = "#d8f6ff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`SHIELD ${who.shield}`, x, y);
  }
}

// While a boss is alive the battlefield's edges glow red, pulsing slowly.
function drawBossDanger(ctx, x0, x1) {
  const pulse = REDUCED_MOTION ? 0.5 : 0.5 + Math.sin(performance.now() / 400) * 0.5;
  const w = x1 - x0;
  const glow = ctx.createRadialGradient(x0 + w / 2, battleCssH / 2, Math.min(w, battleCssH) * 0.35, x0 + w / 2, battleCssH / 2, Math.max(w, battleCssH) * 0.75);
  glow.addColorStop(0, "rgba(200, 20, 10, 0)");
  glow.addColorStop(1, `rgba(200, 20, 10, ${0.3 + pulse * 0.22})`);
  ctx.fillStyle = glow;
  ctx.fillRect(x0, 0, w, battleCssH);
}

// A beaten boss tips over and fades away during the win.
function drawFallenBoss(ctx, feetY) {
  const f = fallenBoss;
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - f.t);
  ctx.translate(f.x, feetY);
  ctx.rotate(f.t * 1.5);
  ctx.translate(-f.x, -feetY);
  drawBoss(ctx, { ...f.boss, attackIn: 99, hitFlash: 0, shield: 0 }, f.x - 32, f.x + 200, feetY);
  ctx.restore();
}

function drawBossBar(ctx, x0, x1) {
  const barX = x0 + 36;
  const barW = x1 - x0 - 72;
  roundRectFill(ctx, barX, 4, barW, 12, 6, "#1c130a");
  roundRectFill(ctx, barX, 4, barW * (boss.hp / boss.maxHp), 12, 6, "#d8432f");
  ctx.font = "800 10px system-ui, sans-serif";
  const label = `${isFinalWave(wave) ? "FINAL BOSS: " : ""}${boss.kind.name.toUpperCase()} ${Math.ceil(boss.hp)}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#1c130a";
  ctx.strokeText(label, barX + barW / 2, 10.5);
  ctx.fillStyle = "#fdf6e8";
  ctx.fillText(label, barX + barW / 2, 10.5);
}

function drawWorldDeco(ctx, deco, w, groundY, time) {
  for (let i = 0; i < 5; i++) {
    const x = ((i + 0.5) / 5) * w + (i % 2 ? 9 : -7);
    if (deco === "trees") {
      ctx.beginPath();
      ctx.rect(x - 2, groundY - 8, 4, 8);
      inked(ctx, "#7a5430", 1);
      ctx.beginPath();
      ctx.moveTo(x - 9, groundY - 7);
      ctx.lineTo(x, groundY - 26);
      ctx.lineTo(x + 9, groundY - 7);
      ctx.closePath();
      inked(ctx, "#3f8f3a", 1);
    } else if (deco === "cactus") {
      ctx.beginPath();
      ctx.roundRect(x - 2.5, groundY - 20, 5, 20, 2.5);
      ctx.roundRect(x - 8, groundY - 15, 4, 8, 2);
      ctx.roundRect(x + 4, groundY - 17, 4, 8, 2);
      inked(ctx, "#5c9a3f", 1);
    } else if (deco === "snow") {
      ctx.beginPath();
      ctx.moveTo(x - 12, groundY);
      ctx.lineTo(x, groundY - 22);
      ctx.lineTo(x + 12, groundY);
      ctx.closePath();
      inked(ctx, "#9fc4dc", 1);
      ctx.beginPath();
      ctx.moveTo(x - 4.5, groundY - 14);
      ctx.lineTo(x, groundY - 22);
      ctx.lineTo(x + 4.5, groundY - 14);
      ctx.closePath();
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(x - 10, groundY);
      ctx.lineTo(x - 3, groundY - 18);
      ctx.lineTo(x + 3, groundY - 18);
      ctx.lineTo(x + 10, groundY);
      ctx.closePath();
      inked(ctx, "#2a1410", 1);
      ctx.beginPath();
      ctx.fillStyle = "#ff8a3d";
      ctx.ellipse(x, groundY - 18, 3.5, 1.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Falling snow or rising embers.
  if (deco === "snow" || deco === "embers") {
    ctx.fillStyle = deco === "snow" ? "#ffffff" : "#ff9a4a";
    for (let i = 0; i < 12; i++) {
      const drift = (time * (deco === "snow" ? 14 : -18) + i * 37) % groundY;
      const y = drift < 0 ? drift + groundY : drift;
      const x = (i * 83 + Math.sin(time + i) * 8) % w;
      ctx.beginPath();
      ctx.arc(x, y, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// The world's cartoon battlefield, with a banner at each army's camp.
function drawBattlefield(ctx, x0, x1, groundY) {
  const time = performance.now() / 1000;
  drawWorldScenery(ctx, WORLDS[currentWorld].theme, battleCssW, battleCssH, groundY, time);
  drawCampBanners(ctx, x0, x1, groundY, time);
}

function drawWorldScenery(ctx, theme, w, h, groundY, time) {
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, theme.skyTop);
  sky.addColorStop(1, theme.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, groundY);

  // Clouds, except in the smoke of the Lava Core.
  if (theme.deco !== "embers") {
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    for (const [speed, start, y, r] of [[5, 0.15, 0.2, 7], [3, 0.55, 0.28, 9], [4, 0.85, 0.14, 6]]) {
      const cx = ((start * w + time * speed) % (w + 60)) - 30;
      for (const [dx, dy, size] of [[-r, 0, 0.8], [0, -r * 0.4, 1], [r, 0, 0.8]]) {
        ctx.beginPath();
        ctx.arc(cx + dx, y * h + dy, r * size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  for (const [color, baseUp, bumps, phase] of [[theme.hillBack, 15, 3, 0.4], [theme.hillFront, 8, 4, 1.8]]) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    for (let i = 0; i <= 40; i++) {
      const px = (w * i) / 40;
      ctx.lineTo(px, groundY - baseUp - Math.abs(Math.sin((i / 40) * Math.PI * bumps + phase)) * 12);
    }
    ctx.lineTo(w, groundY);
    ctx.closePath();
    ctx.fill();
  }
  drawWorldDeco(ctx, theme.deco, w, groundY, time);

  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, groundY, w, h - groundY);
  ctx.fillStyle = theme.groundDark;
  ctx.fillRect(0, groundY + 8, w, h - groundY - 8);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(w, groundY);
  ctx.stroke();
}

function drawCampBanners(ctx, x0, x1, groundY, time) {
  const flap = Math.sin(time * 4) * 2.5;
  for (const [x, color, dir] of [[x0 - 8, "#3a7ddb", 1], [x1 + 8, "#d8432f", -1]]) {
    ctx.beginPath();
    ctx.rect(x - 1.2, groundY - 28, 2.4, 30);
    inked(ctx, "#8a5f36", 1);
    ctx.beginPath();
    ctx.moveTo(x, groundY - 28);
    ctx.quadraticCurveTo(x + dir * 7, groundY - 26 + flap, x + dir * 13, groundY - 23 + flap);
    ctx.lineTo(x, groundY - 17);
    ctx.closePath();
    inked(ctx, color, 1.2);
  }
}

// White text with a dark edge, readable on the bright sky.
function drawLaneText(ctx, text, x, y) {
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.strokeStyle = OUTLINE;
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

// Where the wave is won and lost: notches on the bar at 70% and 30%, labelled,
// so it is clear how far the line has to go either way.
function drawBarMarks(ctx, x0, x1, barY, barH) {
  ctx.save();
  ctx.font = "900 9px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  for (const [share, label, color] of [[WIN_RATIO, "WIN", "#ffe14d"], [LOSE_RATIO, "LOSE", "#ff8a7a"]]) {
    const x = x0 + (x1 - x0) * share;
    ctx.fillStyle = "#1c130a";
    ctx.fillRect(x - 2.5, barY - 4, 5, barH + 8);
    ctx.fillStyle = color;
    ctx.fillRect(x - 1.25, barY - 3, 2.5, barH + 6);
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1c130a";
    ctx.strokeText(label, x, barY - 5);
    ctx.fillText(label, x, barY - 5);
  }
  ctx.restore();
}

function drawBattle() {
  if (!battleCtx || battleCssW <= 0) return;
  const ctx = battleCtx;
  ctx.clearRect(0, 0, battleCssW, battleCssH);

  const padding = 16;
  const barY = battleCssH * 0.78;
  const barH = 10;
  const x0 = padding;
  const x1 = battleCssW - padding;
  const total = playerPower + enemyPower;
  const ratio = total > 0 ? playerPower / total : 0.5;
  const markerX = x0 + (x1 - x0) * ratio;
  const groundY = battleCssH * 0.62;

  drawBattlefield(ctx, x0, x1, groundY);

  roundRectFill(ctx, x0, barY, x1 - x0, barH, barH / 2, "#1c130a");
  roundRectFill(ctx, x0, barY, markerX - x0, barH, barH / 2, "#3a7ddb");
  roundRectFill(ctx, markerX, barY, x1 - markerX, barH, barH / 2, save.colorBlind ? "#f0a020" : "#d8432f");
  drawBarMarks(ctx, x0, x1, barY, barH);
  if (chillFor > 0) {
    ctx.fillStyle = `rgba(170, 225, 255, ${Math.min(0.25, chillFor * 0.15)})`;
    ctx.fillRect(markerX, 0, battleCssW - markerX, barY - 2);
  }

  ctx.beginPath();
  ctx.fillStyle = "#ffcc33";
  ctx.arc(markerX, barY + barH / 2, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#3a2414";
  ctx.stroke();

  const won = gameState === "choosing";
  const fleeing = won ? (performance.now() - winAt) * 0.16 : 0;
  const playerLook = fighterLook();
  const enemyLook = enemyType ? enemyType.look : enemyRank().look;
  const playerX = Math.max(x0 + 12, markerX - 20) - shove.player * 8;
  const enemyX = Math.min(x1 - 12, markerX + 20) + shove.enemy * 8 + fleeing;
  const moodFor = (ahead, hit) => (hit > 0.3 ? "wince" : ahead > 0.58 ? "happy" : ahead < 0.42 ? "scared" : "neutral");
  const fight = updateFightCount();
  drawCrowd(ctx, playerX, x0, -1, CROWD_FIRST_GAP, playerLook, fight.player / armyStrength(), groundY, won);
  if (boss) drawCrowd(ctx, Math.min(x1 - 22, markerX + 32), x1, 1, CROWD_BOSS_GAP, enemyRank().look, fight.enemy / enemyRank().strength, groundY, false);
  else drawCrowd(ctx, enemyX, x1, 1, CROWD_FIRST_GAP, enemyLook, fight.enemy / enemyRank().strength, groundY, false);
  // Behind the two fighters, so the ones still fighting are always in plain view.
  for (const f of fallers) {
    ctx.save();
    ctx.globalAlpha = FALLER_ALPHA * Math.min(1, 2 * (1 - f.age));
    ctx.translate(f.x, f.y);
    ctx.rotate(f.angle);
    drawSoldier(ctx, 0, 10, f.facing, f.look, "idle", 0, "wince");
    ctx.restore();
  }
  if (rankUp) drawRankUp(ctx, playerX, groundY, playerLook);
  else drawArmyFighter(ctx, playerX, groundY, playerLook, 1, won ? "cheer" : "fight", won ? "happy" : moodFor(ratio, shove.player));
  if (!boss) {
    drawArmyFighter(ctx, enemyX, groundY, enemyLook, won ? 1 : -1, won ? "flee" : "fight", won ? "scared" : moodFor(1 - ratio, shove.enemy));
  }

  // Soldiers on their way, on a row of their own so they stand out from the
  // armies already at the front.
  for (const m of marchers) {
    // Only charges are shown walking.
    if (m.t < 0 || !m.charge) continue;
    const x = m.side === "enemy" ? x1 - (x1 - markerX) * m.t : x0 + (markerX - x0) * m.t;
    const feetY = battleCssH * 0.72;
    if (m.side === "bomb") drawBombIcon(ctx, x, feetY - 8);
    else if (m.charge) {
      for (const offset of [-14, 0, 14]) drawSoldier(ctx, x + offset, feetY, 1, "charge", "walk", offset);
    } else {
      const facing = m.side === "player" ? 1 : -1;
      drawSoldier(ctx, x, feetY, facing, m.side === "player" ? ARMY_RANKS[armyRank].look : enemyRank().look, "walk", m.t * 40);
    }
    const headCount = Math.round(m.value / (m.side === "enemy" ? enemyRank().strength : armyStrength()));
    if (headCount >= 2 && m.side !== "bomb") {
      ctx.font = "800 10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#1c130a";
      ctx.strokeText(headCount, x, feetY - 29);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(headCount, x, feetY - 29);
    }
  }
  if (boss) drawBossDanger(ctx, x0, x1);
  if (boss) drawBoss(ctx, boss, markerX, x1, battleCssH * 0.75);
  if (fallenBoss) drawFallenBoss(ctx, battleCssH * 0.75);
  for (const c of clashes) {
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(255, 204, 51, ${1 - c.t})`;
    ctx.arc(markerX, barY + barH / 2, 9 + c.t * 14, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.font = "700 13px system-ui, sans-serif";
  ctx.fillStyle = "#fdf6e8";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  // Counted in soldiers of each army's rank, so numbers stay small as ranks rise.
  // During a boss fight the enemy's number sits over the boss, below its health bar.
  const minCountY = boss ? 26 : 12;
  // Who is still standing on each side, in the same unit, so the bigger
  // number is always the side that is winning.
  drawArmyCount(ctx, playerX, Math.max(minCountY, fighterTop(playerLook, groundY) - 9), Math.round(fight.player));
  if (boss) drawArmyCount(ctx, Math.min(x1 - 22, markerX + 32), Math.max(minCountY, battleCssH * 0.75 - 62), Math.round(fight.enemy));
  else if (!won) drawArmyCount(ctx, enemyX, Math.max(minCountY, fighterTop(enemyLook, groundY) - 9), Math.round(fight.enemy));
  ctx.font = "800 12px system-ui, sans-serif";
  ctx.fillStyle = "#ffcc33";
  ctx.textBaseline = "alphabetic";
  if (rallying) {
    ctx.font = "800 12px system-ui, sans-serif";
    ctx.fillStyle = "#ffcc33";
    ctx.textAlign = "left";
    drawLaneText(ctx, `RALLY ${Math.round(rallyReserve)}`, x0, battleCssH * 0.74);
  }
  if (boss) drawBossBar(ctx, x0, x1);
  // Says when a strike would cancel the attack that's coming.
  if (boss && gameState === "playing" && boss.attackIn < BOSS_WARNING_SECONDS && strikeCooldown <= 0 && strikeHeld >= COUNTER_HOLD_SECONDS) {
    ctx.font = "800 13px system-ui, sans-serif";
    ctx.fillStyle = "#ffe14d";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    drawLaneText(ctx, "STRIKE NOW!", (x0 + x1) / 2, battleCssH * 0.74);
  }
  else if (enemyType || waveEvent) {
    ctx.font = "800 12px system-ui, sans-serif";
    ctx.fillStyle = "#ffcc33";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    drawLaneText(ctx, (enemyType || waveEvent).name.toUpperCase(), battleCssW / 2, battleCssH - 5);
  }
}

// =====================================================================
// Effects — sparks, confetti, screen shake
// =====================================================================

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function spawnParticle(particle) {
  if (particles.length < MAX_PARTICLES) particles.push({ age: 0, angle: 0, spin: 0, gravity: 0, ...particle });
}

// Sparks where the tooth meets the gear it just hit.
function spawnToothSparks(row, col) {
  const x = boardOrigin.x + ((col + DRIVER_COL) / 2 + 0.5) * cellSize;
  const y = boardOrigin.y + ((row + DRIVER_ROW) / 2 + 0.5) * cellSize;
  for (let i = 0; i < 6; i++) {
    const angle = randomBetween(0, Math.PI * 2);
    const speed = randomBetween(40, 170);
    spawnParticle({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      gravity: 320,
      life: randomBetween(0.15, 0.35),
      size: randomBetween(1.5, 3),
      color: i % 2 ? "#ffcc33" : "#fff3c4",
    });
  }
}

// A cell's centre on the effects canvas.
function cellCenter(row, col) {
  return { x: boardOrigin.x + (col + 0.5) * cellSize, y: boardOrigin.y + (row + 0.5) * cellSize };
}

function spawnRustBurst(row, col, colorA = "#a4552a", colorB = "#6e3a1c") {
  const { x, y } = cellCenter(row, col);
  for (let i = 0; i < 18; i++) {
    const angle = randomBetween(0, Math.PI * 2);
    const speed = randomBetween(30, 130);
    spawnParticle({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      gravity: 120,
      life: randomBetween(0.3, 0.7),
      size: randomBetween(2, 5),
      color: i % 2 ? colorA : colorB,
    });
  }
}

// Sparks and a floating number where a soldier or bomb reached the front line.
function frontLineFx() {
  const total = playerPower + enemyPower;
  const ratio = total > 0 ? playerPower / total : 0.5;
  return { x: laneRect.x + 16 + (laneRect.w - 32) * ratio, y: laneRect.y + laneRect.h * 0.5 };
}

// Only the big moments get a number, counted the way the army totals are. Hits
// that land close together add up into one number, so they never pile up.
// The numbers above the armies, shown as a fight: who is still standing.
// Whenever the bar moves one way, the other side's number drops, so both
// always match the bar exactly. Arriving soldiers, Lightning and bombs are
// seen knocking the enemy down; enemy reinforcements knock the army down.
// The rules underneath (playerPower and enemyPower) are unchanged.
function updateFightCount() {
  const total = playerPower + enemyPower;
  const share = total > 0 ? playerPower / total : 0.5;
  const now = performance.now();
  if (!fightCount) fightCount = { player: playerPower, enemy: enemyPower, share, lost: { player: 0, enemy: 0 }, shownAt: now };
  const fight = fightCount;
  if (share > fight.share && share < 1) {
    const enemy = (fight.player * (1 - share)) / share;
    fight.lost.enemy += fight.enemy - enemy;
    fight.enemy = enemy;
  } else if (share < fight.share && share > 0) {
    const player = (fight.enemy * share) / (1 - share);
    fight.lost.player += fight.player - player;
    fight.player = player;
  }
  fight.share = share;
  const big = (side) => fight.lost[side] >= Math.max(1, fight[side] * FIGHT_BIG_HIT);
  if (now - fight.shownAt >= FIGHT_HIT_SECONDS * 1000 || big("enemy") || big("player")) {
    for (const side of ["enemy", "player"]) {
      if (fight.lost[side] < 1) continue;
      spawnHitNumber(side, fight.lost[side], side === "enemy" ? "#ffe14d" : "#ff8a7a");
      fight.lost[side] = 0;
    }
    fight.shownAt = now;
  }
  return fight;
}

function spawnHitNumber(side, amount, color) {
  const number = hitNumbers.find((n) => n.side === side);
  if (number) {
    number.amount = amount;
    number.color = color;
    number.age = 0;
    number.rise = 0;
  } else {
    hitNumbers.push({ side, amount, color, age: 0, rise: 0 });
  }
}

function spawnFaller(side) {
  const now = performance.now();
  if (fallers.length >= MAX_FALLERS || now - lastFallerAt < FALLER_GAP_MS) return;
  lastFallerAt = now;
  const total = playerPower + enemyPower;
  const markerX = 16 + (battleCssW - 32) * (total > 0 ? playerPower / total : 0.5);
  const away = side === "enemy" ? 1 : -1;
  fallers.push({
    x: markerX + away * FALLER_START_GAP,
    y: battleCssH * 0.5,
    vx: away * randomBetween(60, 110),
    vy: randomBetween(-110, -60),
    spin: away * randomBetween(4, 8),
    angle: 0,
    age: 0,
    look: side === "enemy" ? enemyRank().look : ARMY_RANKS[armyRank].look,
    facing: -away,
  });
}

function spawnFrontLineHit(marcher) {
  const { x, y } = frontLineFx();
  const isEnemy = marcher.side === "enemy";
  if (isEnemy) {
    shove.player = Math.max(shove.player, 0.7);
    spawnFaller("player");
  } else {
    shove.enemy = 1;
    spawnFaller("enemy");
    if (marcher.charge || marcher.side === "bomb") {
      hitStop = HIT_STOP_SECONDS;
      screenShake = Math.max(screenShake, 3);
    }
  }
  for (let i = 0; i < 3; i++) {
    spawnParticle({
      x,
      y,
      vx: randomBetween(-90, 90),
      vy: randomBetween(-110, 10),
      gravity: 260,
      life: randomBetween(0.2, 0.4),
      size: randomBetween(1.5, 3),
      color: isEnemy ? "#ff9a85" : i % 2 ? "#ffcc33" : "#ffffff",
    });
  }
  if (!isEnemy) maybeDropGear();
}

// The same in a daily challenge for everyone, like the rest of its waves.
function planGearDrop() {
  if (boss) return NO_GEAR_DROP;
  return GEAR_DROP_EARLIEST + runRandom(`gearDrop${wave}`)() * (GEAR_DROP_LATEST - GEAR_DROP_EARLIEST);
}

// The same in a daily challenge for everyone. Bomb Week's gears are all bombs
// already, and a machine at its cap of special gears gets a normal one.
function droppedGearType() {
  if (currentEvent?.id === "bombs" || specialGearCount() >= specialGearCap()) return newGearType();
  const random = runRandom(`gearDropType${wave}`);
  if (random() >= SPECIAL_DROP_CHANCE) return newGearType();
  const types = ["big", "booster", "bomb"];
  if (featureOn("newGears")) types.push("far", "lone");
  if (featureOn("powerGears")) types.push("spark", "oil", "ice");
  return types[Math.floor(random() * types.length)];
}

// Flies to the tray when a hit lands on the enemy. A full tray just waits for
// the next hit, so a gear is never lost for want of room.
function maybeDropGear() {
  if (gameState !== "playing" || gearTray.length >= TRAY_SLOTS) return;
  let level = 0;
  if (boss) {
    if (boss.gearDropped || boss.hp > boss.maxHp * BOSS_DROP_HEALTH) return;
    boss.gearDropped = true;
    level = BOSS_DROP_LEVEL;
  } else {
    if (gearDropAt === NO_GEAR_DROP || waveTime < gearDropAt) return;
    gearDropAt = NO_GEAR_DROP;
    level = 1;
  }
  sendGearToTray(droppedGearType(), level, frontLineFx());
}

function sendGearToTray(type, level, from) {
  const item = { type, level, arriving: true };
  gearTray.push(item);
  renderGearTray();
  flyGearToTray(item, gearTray.length - 1, from);
}

function flyGearToTray(item, index, from) {
  const land = () => {
    item.arriving = false;
    playLootSound();
  };
  if (save.lessMotion || REDUCED_MOTION) {
    land();
    return;
  }
  const frame = document.getElementById("app-frame").getBoundingClientRect();
  const slot = document.querySelector(`.tray-slot[data-index="${index}"]`).getBoundingClientRect();
  const dx = slot.left + slot.width / 2 - frame.left - from.x;
  const dy = slot.top + slot.height / 2 - frame.top - from.y;
  const flyer = gearIcon(item.type, false, item.level);
  flyer.classList.add("gear-flyer");
  flyer.style.left = `${from.x}px`;
  flyer.style.top = `${from.y}px`;
  document.getElementById("app-frame").append(flyer);
  const flight = flyer.animate([
    { transform: "translate(-50%, -50%) scale(0.5)" },
    { transform: `translate(calc(-50% + ${dx * 0.25}px), calc(-50% - 30px)) scale(1.2)`, offset: 0.3 },
    { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1)` },
  ], { duration: 650, easing: "ease-in" });
  flight.onfinish = flight.oncancel = () => {
    flyer.remove();
    land();
  };
}

// The same in a daily challenge for everyone, like the rest of its waves.
function planTreasureGoblin() {
  if (wave < GOBLIN_FIRST_WAVE || boss) return NO_GEAR_DROP;
  const random = runRandom(`treasure${wave}`);
  if (random() >= GOBLIN_WAVE_CHANCE) return NO_GEAR_DROP;
  return GOBLIN_EARLIEST + random() * (GOBLIN_LATEST - GOBLIN_EARLIEST);
}

// A four-pointed twinkle.
function drawTwinkle(ctx, x, y, r, color) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fillStyle = color;
  ctx.fill();
}

// The treasure goblin, 48 units square: a sneaky goblin in a bandana, running
// hunched under a big bulging sack of gold, so it never looks like an ordinary
// monster. It runs from right to left, so it's drawn facing left.
function drawTreasureGoblin(ctx) {
  const skin = "#7fc04a";
  ctx.save();
  ctx.translate(48, 0);
  ctx.scale(-1, 1);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Legs mid-stride.
  for (const [hip, foot] of [[[24, 34], [17, 43]], [[27, 34], [33, 42]]]) {
    ctx.beginPath();
    ctx.moveTo(...hip);
    ctx.lineTo(...foot);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = skin;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(foot[0] + 1.4, foot[1] + 0.4, 2.8, 1.6, 0, 0, Math.PI * 2);
    inked(ctx, "#5a3414", 0.9);
  }

  // The sack of gold on its back, with coins peeking out of the top.
  ctx.beginPath();
  ctx.moveTo(14, 13);
  ctx.quadraticCurveTo(1, 16, 3, 28);
  ctx.quadraticCurveTo(6, 38, 16, 37);
  ctx.quadraticCurveTo(27, 36, 25, 24);
  ctx.quadraticCurveTo(23, 15, 18, 13);
  ctx.closePath();
  inked(ctx, "#c9a35a", 1.4);
  ctx.strokeStyle = "#9a7a3a";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(8, 22);
  ctx.quadraticCurveTo(10, 28, 9, 33);
  ctx.moveTo(19, 21);
  ctx.quadraticCurveTo(21, 27, 19, 33);
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(6.4, 25, 5.4, 4.4);
  inked(ctx, "#a8834a", 0.7);
  for (const [x, y] of [[12, 12], [16.5, 11], [14, 9]]) {
    ctx.beginPath();
    ctx.ellipse(x, y, 2.8, 1.8, 0, 0, Math.PI * 2);
    inked(ctx, "#ffd23f", 0.8);
  }
  ctx.beginPath();
  ctx.ellipse(15, 14.4, 4.6, 1.6, 0, 0, Math.PI * 2);
  inked(ctx, "#8a6a30", 0.9);

  // A hunched little body in a brown vest.
  ctx.beginPath();
  ctx.ellipse(26.5, 28, 5.6, 7, 0.5, 0, Math.PI * 2);
  inked(ctx, "#6b4422", 1.3);

  // Arm reaching back to hold the sack shut.
  ctx.beginPath();
  ctx.moveTo(28, 25);
  ctx.quadraticCurveTo(22, 20, 18.5, 15);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3.6;
  ctx.stroke();
  ctx.strokeStyle = skin;
  ctx.lineWidth = 2;
  ctx.stroke();
  inkedCircle(ctx, 18.5, 15, 1.9, skin, 0.9);

  // Head: a long ear, a big grin, and a red bandana.
  ctx.beginPath();
  ctx.moveTo(29, 17);
  ctx.lineTo(21, 13);
  ctx.lineTo(28.5, 21);
  ctx.closePath();
  inked(ctx, skin, 1.1);
  inkedCircle(ctx, 33, 19, 7, skin, 1.4);
  ctx.beginPath();
  ctx.moveTo(38.5, 19);
  ctx.lineTo(43, 21.5);
  ctx.lineTo(38.5, 22.4);
  ctx.closePath();
  inked(ctx, mixColor(skin, "#ffffff", 0.25), 1);
  inkedCircle(ctx, 35.4, 17.4, 2, "#ffffff", 0.7);
  inkedCircle(ctx, 36.2, 17.6, 1, OUTLINE, 0.3);
  ctx.beginPath();
  ctx.moveTo(31, 23);
  ctx.quadraticCurveTo(35, 26.6, 38.6, 23.4);
  ctx.closePath();
  inked(ctx, "#fff7e0", 0.9);
  ctx.beginPath();
  ctx.arc(33, 19, 7.3, Math.PI * 1.05, Math.PI * 1.95);
  ctx.quadraticCurveTo(33, 15, 25.8, 18);
  ctx.closePath();
  inked(ctx, "#d8432f", 1.2);
  ctx.beginPath();
  ctx.moveTo(26.6, 15.4);
  ctx.lineTo(21.6, 13.6);
  ctx.lineTo(23, 17.4);
  ctx.closePath();
  inked(ctx, "#d8432f", 0.9);
  ctx.fillStyle = "#fff7e0";
  for (const [x, y] of [[30, 14.6], [35, 13.6], [39, 15.4]]) {
    ctx.beginPath();
    ctx.arc(x, y, 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  // Twinkles around the gold.
  for (const [x, y, r] of [[4, 9, 2.6], [22, 6, 2], [2, 33, 1.8], [24, 40, 1.6]]) drawTwinkle(ctx, x, y, r, "#fff3a8");
  ctx.restore();
}

function treasureGoblinIcon() {
  return artIcon((ctx) => drawTreasureGoblin(ctx));
}

const GOBLIN_TAP_HINT_CATCHES = 3; // the Tap! bubble shows until this many have been caught

function spawnTreasureGoblin() {
  treasureAt = NO_GEAR_DROP;
  discover("enemy:treasure");
  treasureGoblin = { age: 0, seconds: runEasy ? GOBLIN_SECONDS_EASY : GOBLIN_SECONDS, sparkle: 0 };
  const el = document.getElementById("treasure-goblin");
  document.getElementById("treasure-goblin-art").replaceChildren(treasureGoblinIcon());
  document.getElementById("treasure-goblin-tap").classList.toggle("hidden", statValue("goblins") >= GOBLIN_TAP_HINT_CATCHES);
  el.classList.remove("hidden");
  placeTreasureGoblin();
  playGoblinSound();
}

function treasureGoblinPoint() {
  const size = 32;
  const share = treasureGoblin.age / treasureGoblin.seconds;
  const hop = save.lessMotion || REDUCED_MOTION ? 0 : Math.abs(Math.sin(treasureGoblin.age * 11)) * 7;
  return {
    x: laneRect.x + laneRect.w + size - (laneRect.w + size * 2) * share,
    y: laneRect.y + laneRect.h * 0.6 - hop,
  };
}

function placeTreasureGoblin() {
  const { x, y } = treasureGoblinPoint();
  document.getElementById("treasure-goblin").style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
}

// In real time, so double speed doesn't make it harder to catch. It waits for
// a pause or a tip, and is gone when the wave ends.
function updateTreasureGoblin(dt) {
  if (gameState === "playing" && treasureAt !== NO_GEAR_DROP && waveTime >= treasureAt) spawnTreasureGoblin();
  if (!treasureGoblin || gameState === "paused" || gameState === "tip") return;
  if (gameState !== "playing") {
    clearTreasureGoblin();
    return;
  }
  treasureGoblin.age += dt;
  if (treasureGoblin.age >= treasureGoblin.seconds) {
    clearTreasureGoblin();
    showToast("It got away!");
    return;
  }
  placeTreasureGoblin();
  treasureGoblin.sparkle -= dt;
  if (treasureGoblin.sparkle <= 0 && !save.lessMotion) {
    treasureGoblin.sparkle = 0.12;
    const { x, y } = treasureGoblinPoint();
    spawnParticle({ x: x + 14, y, vx: randomBetween(10, 40), vy: randomBetween(-40, -10), gravity: 120, life: randomBetween(0.25, 0.45), size: randomBetween(1.5, 3), color: "#ffcc33" });
  }
}

// Coins, or a gear for the tray when there's room for one.
function catchTreasureGoblin() {
  if (!treasureGoblin || gameState !== "playing") return;
  const from = treasureGoblinPoint();
  const random = runRandom(`treasureLoot${wave}`);
  const roll = random();
  if (roll < GOBLIN_GEAR_CHANCE && gearTray.length < TRAY_SLOTS) {
    sendGearToTray(droppedGearType(), 1, from);
    showToast("Treasure! Free gear");
  } else {
    const coins = GOBLIN_COINS_MIN + Math.floor(random() * (GOBLIN_COINS_MAX - GOBLIN_COINS_MIN + 1));
    runBonusCoins += coins;
    showToast(`Treasure! +${coins} coins`);
  }
  for (let i = 0; i < 14; i++) {
    spawnParticle({ x: from.x, y: from.y, vx: randomBetween(-110, 110), vy: randomBetween(-170, -40), gravity: 260, life: randomBetween(0.3, 0.6), size: randomBetween(2, 4), color: i % 2 ? "#ffcc33" : "#fff3c4" });
  }
  playLootSound();
  recordStat("goblins");
  clearTreasureGoblin();
}

function clearTreasureGoblin() {
  treasureGoblin = null;
  document.getElementById("treasure-goblin")?.classList.add("hidden");
}

function spawnConfetti() {
  if (save.lessMotion) return;
  if (REDUCED_MOTION) return;
  const colors = ["#ffcc33", "#3a7ddb", "#8bd65a", "#ff8a3d", "#fdf6e8"];
  for (let i = 0; i < 70; i++) {
    spawnParticle({
      x: randomBetween(0, fxCssW),
      y: randomBetween(-40, 0),
      vx: randomBetween(-50, 50),
      vy: randomBetween(60, 220),
      gravity: 180,
      life: randomBetween(1, 1.8),
      size: randomBetween(4, 8),
      color: colors[i % colors.length],
      angle: randomBetween(0, Math.PI),
      spin: randomBetween(-9, 9),
    });
  }
}

function updateFx(dt) {
  updateTreasureGoblin(dt);
  updateRankUp(dt);
  for (const p of particles) {
    p.age += dt;
    p.vy += p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.angle += p.spin * dt;
  }
  particles = particles.filter((p) => p.age < p.life);
  for (const number of hitNumbers) {
    number.age += dt;
    number.rise += HIT_NUMBER_RISE * dt;
  }
  hitNumbers = hitNumbers.filter((number) => number.age < HIT_NUMBER_SECONDS);
  for (const f of fallers) {
    f.age += dt;
    f.vy += 340 * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.angle += f.spin * dt;
  }
  fallers = fallers.filter((f) => f.age < 1);
  for (const bolt of bolts) bolt.age += dt;
  bolts = bolts.filter((bolt) => bolt.age < 0.25);
  shove.player = Math.max(0, shove.player - dt * 5);
  shove.enemy = Math.max(0, shove.enemy - dt * 5);
  if (fallenBoss) {
    fallenBoss.t += dt / (VICTORY_MS / 1000);
    if (fallenBoss.t >= 1) fallenBoss = null;
  }

  screenShake = Math.max(0, screenShake - SHAKE_FADE_PER_SEC * dt);
  // Only the battle shakes. Shaking the board too, where the player is
  // dragging gears, was dizzying when bombs go off quickly.
  const shake = REDUCED_MOTION ? 0 : screenShake;
  document.getElementById("battle-canvas").style.transform = shake > 0
    ? `translate(${randomBetween(-shake, shake)}px, ${randomBetween(-shake, shake)}px)`
    : "";
}

function drawFx() {
  if (!fxCtx) return;
  const ctx = fxCtx;
  ctx.clearRect(0, 0, fxCssW, fxCssH);
  if (drag?.tray !== undefined) drawGearCell(ctx, boardOrigin.x + drag.x, boardOrigin.y + drag.y, cellSize * 1.12, drag.cell);

  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = 1 - p.age / p.life;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
    ctx.restore();
  }

  // Lightning strikes, a jagged line from the top of the battle down.
  for (const bolt of bolts) {
    const top = laneRect.y;
    const bottom = laneRect.y + laneRect.h * 0.68;
    const jag = [[0, 0], [-7, 0.3], [5, 0.45], [-5, 0.7], [0, 1]];
    ctx.globalAlpha = 1 - bolt.age / 0.25;
    for (const [color, width] of [[OUTLINE, 7], ["#ffe14d", 4]]) {
      ctx.beginPath();
      for (const [dx, t] of jag) ctx.lineTo(bolt.x + dx, top + (bottom - top) * t);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = "round";
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3;
  const front = frontLineFx();
  const gap = boss ? HIT_NUMBER_BOSS_GAP : HIT_NUMBER_GAP;
  for (const number of hitNumbers) {
    const value = Math.max(1, Math.round(number.amount));
    const label = `-${shortNumber(value)}`;
    const wanted = front.x + (number.side === "enemy" ? gap : -gap);
    const x = Math.max(laneRect.x + HIT_NUMBER_MARGIN, Math.min(laneRect.x + laneRect.w - HIT_NUMBER_MARGIN, wanted));
    const y = laneRect.y + laneRect.h * 0.34 - number.rise;
    // Bigger hits get bigger numbers. They stay solid at first, then fade.
    ctx.font = `800 ${Math.round(Math.min(22, 14 + Math.log10(value) * 3))}px system-ui, sans-serif`;
    ctx.globalAlpha = Math.min(1, 2 * (1 - number.age / HIT_NUMBER_SECONDS));
    ctx.strokeStyle = "#1c130a";
    ctx.strokeText(label, x, y);
    ctx.fillStyle = number.color;
    ctx.fillText(label, x, y);
  }
  ctx.globalAlpha = 1;
}

// =====================================================================
// Sound — tiny WebAudio synth, no assets
// =====================================================================

let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
}

function toggleSpeed() {
  save.speed = save.speed === 2 ? 1 : 2;
  writeSave();
  updateSettingButtons();
}

function toggleMusic() {
  save.music = !save.music;
  writeSave();
  updateSettingButtons();
}

function toggleVibrate() {
  save.vibrate = !save.vibrate;
  writeSave();
  updateSettingButtons();
  buzz(30);
}

function updateSettingButtons() {
  const speed = document.getElementById("speed-btn");
  speed.textContent = save.speed === 2 ? "2x" : "1x";
  speed.setAttribute("aria-label", save.speed === 2 ? "Game speed: double" : "Game speed: normal");
  speed.classList.toggle("fast", save.speed === 2);
  document.getElementById("music-btn").textContent = `Music: ${save.music ? "on" : "off"}`;
  const vibrate = document.getElementById("vibrate-btn");
  vibrate.textContent = `Vibration: ${save.vibrate ? "on" : "off"}`;
  // Some phones can't vibrate, iPhones among them, so there's nothing to switch.
  vibrate.classList.toggle("hidden", !navigator.vibrate);
}

function buzz(pattern) {
  if (!save.vibrate || !navigator.vibrate || navigator.userActivation?.hasBeenActive === false) return;
  const now = performance.now();
  if (now - lastBuzzAt < BUZZ_GAP_MS) return;
  lastBuzzAt = now;
  navigator.vibrate(pattern);
}

function setMuted(muted) {
  save.muted = muted;
  writeSave();
  updateMuteButton();
}

function updateMuteButton() {
  const button = document.getElementById("mute-btn");
  button.textContent = save.muted ? "\u{1F507}" : "\u{1F50A}";
  button.setAttribute("aria-label", save.muted ? "Turn sound on" : "Turn sound off");
}

function beep(freq, duration, type, gainPeak) {
  if (!audioCtx || save.muted) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type || "sine";
  osc.frequency.value = freq;
  const t0 = audioCtx.currentTime;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(gainPeak || 0.22, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(t0 + duration + 0.02);
}

// Background music, one short loop per world. Steps are eighth notes and 0 is the
// song's root; a null step is a rest. bass has one note per bar of eight steps.
const MUSIC_VOLUME = 0.5; // the notes below are already quiet
const MUSIC_LOOKAHEAD = 0.25; // seconds scheduled in advance, so frame drops don't break the beat
// One boss theme for every world, played a little below that world's key: a
// minor riff over drums.
const BOSS_SONG = {
  bpm: 138, lead: "sawtooth", leadGain: 0.05, bassType: "triangle",
  notes: [0, null, 0, 12, 0, null, 10, null, 0, null, 0, 7, 8, null, 7, 5, 0, null, 0, 12, 0, null, 10, null, 3, null, 5, null, 7, 8, 10, 11],
  bass: [0, 0, -4, -2],
};
const SONGS = [
  { // Green Forest: bright and bouncy
    bpm: 112, root: 60, lead: "triangle", leadGain: 0.16, bassType: "sine",
    notes: [0, null, 4, 7, 9, null, 7, 4, 2, null, 4, 7, 4, null, 2, null, 0, null, 4, 7, 9, null, 12, 9, 7, null, 4, 2, 0, null, null, null],
    bass: [0, -3, -7, -5],
  },
  { // Sun Desert: a slow, winding scale
    bpm: 100, root: 57, lead: "triangle", leadGain: 0.16, bassType: "triangle",
    notes: [0, 1, null, 4, 5, null, 4, 1, 0, null, 7, null, 5, 4, 1, null, 0, 1, null, 4, 7, null, 8, 7, 5, 4, null, 1, 0, null, null, null],
    bass: [0, 0, 1, 0],
  },
  { // Frozen Peaks: sparse, chiming arpeggios
    bpm: 84, root: 62, lead: "sine", leadGain: 0.2, bassType: "sine",
    notes: [0, 7, 12, 15, null, 12, 7, null, -2, 5, 10, 14, null, 10, 5, null, -4, 3, 8, 12, null, 8, 3, null, -5, 2, 7, 10, null, 14, null, null],
    bass: [0, -2, -4, -5],
  },
  { // Lava Core: a low, driving riff
    bpm: 128, root: 52, lead: "square", leadGain: 0.07, bassType: "triangle",
    notes: [0, 0, 3, 0, 5, 0, 3, 0, 0, 0, 3, 0, 7, 6, 5, 3, 0, 0, 3, 0, 5, 0, 3, 0, 10, null, 8, null, 7, null, 5, 3],
    bass: [0, 0, -4, -2],
  },
];

function midiFreq(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function musicNote(note, at, duration, type, peak) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = midiFreq(note);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(gain).connect(musicGain);
  osc.start(at);
  osc.stop(at + duration + 0.02);
}

// Drums for the boss theme, on the music's own volume.
function musicDrum(at, kick) {
  const gain = audioCtx.createGain();
  gain.connect(musicGain);
  if (kick) {
    const osc = audioCtx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, at);
    osc.frequency.exponentialRampToValueAtTime(45, at + 0.12);
    gain.gain.setValueAtTime(0.5, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    osc.connect(gain);
    osc.start(at);
    osc.stop(at + 0.18);
    return;
  }
  if (!noiseBuffer) return;
  const source = audioCtx.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = audioCtx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1800;
  gain.gain.setValueAtTime(0.28, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
  source.connect(filter).connect(gain);
  source.start(at);
  source.stop(at + 0.14);
}

function playMusicStep(song, step, at, stepSeconds) {
  if (song.drums) {
    if (step % 4 === 0) musicDrum(at, true);
    else if (step % 8 === 6) musicDrum(at, false);
  }
  const lead = song.notes[step];
  if (lead !== null) musicNote(song.root + lead, at, stepSeconds * 1.6, song.lead, song.leadGain);
  // The boss theme has a busier bass line.
  if (step % (song.drums ? 2 : 4) === 0) {
    const bass = song.bass[Math.floor(step / 8) % song.bass.length];
    musicNote(song.root + bass - 24, at, stepSeconds * (song.drums ? 1.8 : 3.5), song.bassType, 0.22);
  }
}

function updateMusic() {
  const playing = gameState === "playing" || gameState === "building" || gameState === "choosing" || gameState === "path" || gameState === "chest";
  if (!audioCtx || audioCtx.state !== "running" || !playing || save.muted || !save.music || document.hidden) {
    musicTime = 0;
    return;
  }
  if (!musicGain) {
    musicGain = audioCtx.createGain();
    musicGain.gain.value = MUSIC_VOLUME;
    musicGain.connect(audioCtx.destination);
  }
  const worldSong = SONGS[currentWorld % SONGS.length];
  const song = boss ? { ...BOSS_SONG, root: worldSong.root - 3, drums: true } : worldSong;
  const stepSeconds = 60 / song.bpm / 2;
  const now = audioCtx.currentTime;
  if (musicTime < now) musicTime = now + 0.05;
  while (musicTime < now + MUSIC_LOOKAHEAD) {
    playMusicStep(song, musicStep, musicTime, stepSeconds);
    musicStep = (musicStep + 1) % song.notes.length;
    musicTime += stepSeconds;
  }
}

// A pitch slide, for launches and explosions.
function sweep(fromFreq, toFreq, duration, type, gainPeak) {
  if (!audioCtx || save.muted) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const t0 = audioCtx.currentTime;
  osc.type = type;
  osc.frequency.setValueAtTime(fromFreq, t0);
  osc.frequency.exponentialRampToValueAtTime(toFreq, t0 + duration);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(gainPeak, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(t0 + duration + 0.02);
}

// Filtered noise is what makes these sound like metal rather than a beep.
let noiseBuffer = null;
function noiseBurst(duration, filterType, filterFreq, gainPeak) {
  if (!audioCtx || save.muted) return;
  if (!noiseBuffer) {
    noiseBuffer = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate / 2), audioCtx.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }
  const source = audioCtx.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = audioCtx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = filterFreq;
  const gain = audioCtx.createGain();
  const t0 = audioCtx.currentTime;
  gain.gain.setValueAtTime(gainPeak, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  source.connect(filter).connect(gain).connect(audioCtx.destination);
  source.start();
  source.stop(t0 + duration + 0.02);
}

// Several teeth can land close together, so limit this to a steady patter.
let lastTickSoundAt = 0;
function playTickSound() {
  const now = performance.now();
  if (now - lastTickSoundAt < 110) return;
  lastTickSoundAt = now;
  noiseBurst(0.03, "highpass", 4000, 0.1);
  beep(1800, 0.025, "square", 0.03);
}

// Many gears can fill on the same hit, so one launch sound covers them.
let lastFireSoundAt = 0;
function playFireSound() {
  const now = performance.now();
  if (now - lastFireSoundAt < 70) return;
  lastFireSoundAt = now;
  sweep(420, 880, 0.14, "triangle", 0.1);
}

function playClankSound() {
  noiseBurst(0.09, "bandpass", 2400, 0.25);
  beep(1250, 0.12, "triangle", 0.1);
  beep(1870, 0.09, "sine", 0.06);
}

let lastBoomSoundAt = 0;
function playBoomSound() {
  const now = performance.now();
  if (now - lastBoomSoundAt < 120) return;
  lastBoomSoundAt = now;
  sweep(140, 40, 0.35, "sine", 0.35);
  noiseBurst(0.25, "lowpass", 700, 0.3);
}

function playStrikeSound() {
  sweep(1400, 200, 0.18, "sawtooth", 0.12);
  noiseBurst(0.16, "highpass", 2500, 0.25);
}

// The landing: a deep crash and a roar.
function playBossSound() {
  sweep(95, 45, 0.7, "sawtooth", 0.25);
  noiseBurst(0.4, "lowpass", 500, 0.25);
  sweep(160, 30, 0.6, "sine", 0.4);
  setTimeout(() => sweep(240, 110, 0.55, "sawtooth", 0.16), 120);
}

// A warning siren while the boss falls in.
function playBossWarningSound() {
  for (let i = 0; i < 3; i++) setTimeout(() => sweep(520, 880, 0.3, "square", 0.07), i * 340);
}

function playRustSound() {
  sweep(320, 90, 0.3, "sawtooth", 0.14);
  noiseBurst(0.3, "bandpass", 900, 0.3);
}

function playOverdriveSound() {
  sweep(200, 1200, 0.5, "sawtooth", 0.1);
}

function playLootSound() {
  beep(1050, 0.06, "square", 0.12);
  setTimeout(() => beep(1500, 0.08, "square", 0.12), 50);
}

// The chosen chest rattling, a little higher each time.
function playChestRattleSound(step) {
  noiseBurst(0.06, "bandpass", 1300 + step * 400, 0.2);
  beep(260 + step * 90, 0.06, "square", 0.07);
}

// The lid flying open, then a sparkle. A rare prize gets a fanfare.
function playChestOpenSound(rare) {
  sweep(300, 1300, 0.22, "triangle", 0.14);
  const notes = rare ? [1047, 1319, 1568, 2093, 2637] : [1319, 1760, 2093];
  notes.forEach((note, i) => setTimeout(() => beep(note, 0.12, rare ? "square" : "triangle", rare ? 0.1 : 0.12), 120 + i * 70));
  if (rare) setTimeout(playWinSound, 520);
}

// A rising fanfare with a shimmer, and a deep boom on the reveal.
function playRankUpSound() {
  [523, 659, 784, 1047].forEach((note, i) => setTimeout(() => beep(note, 0.16, "square", 0.14), i * 90));
  setTimeout(() => sweep(600, 2400, 0.4, "triangle", 0.08), 120);
  setTimeout(() => {
    sweep(140, 45, 0.45, "sine", 0.35);
    beep(1319, 0.3, "triangle", 0.12);
    beep(1568, 0.35, "triangle", 0.1);
  }, RANK_UP_SECONDS * RANK_UP_REVEAL * 1000);
}

function playGoblinSound() {
  for (const [delay, note] of [[0, 1320], [70, 1760], [140, 1320], [210, 1760]]) setTimeout(() => beep(note, 0.05, "square", 0.08), delay);
}

function playWinSound() {
  beep(523, 0.12, "square", 0.2);
  setTimeout(() => beep(659, 0.12, "square", 0.2), 110);
  setTimeout(() => {
    beep(784, 0.22, "square", 0.22);
    playClankSound();
  }, 220);
}

function playLoseSound() {
  beep(220, 0.3, "sawtooth", 0.2);
  setTimeout(() => beep(160, 0.4, "sawtooth", 0.2), 150);
}

// =====================================================================
// UI helpers
// =====================================================================

function showToast(text) {
  const el = document.getElementById("combo-toast");
  el.textContent = text;
  el.classList.remove("hidden");
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "";
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add("hidden"), 650);
}

// Quests and achievements can finish together, so these queue up instead of
// replacing each other.
let announcements = [];
let announcing = false;

function announce(text) {
  announcements.push(text);
  if (!announcing) nextAnnouncement();
}

// In a run, over the gear tray, so it covers neither the board nor any button.
// Elsewhere, at the bottom of the screen.
function placeAnnouncement(el) {
  const tray = document.getElementById("gear-tray");
  const inRun = !document.getElementById("game-screen").classList.contains("hidden") && tray.offsetHeight > 0;
  if (!inRun) {
    el.style.left = el.style.bottom = "";
    return;
  }
  const frame = document.getElementById("app-frame").getBoundingClientRect();
  const box = tray.getBoundingClientRect();
  el.style.left = `${box.left + box.width / 2 - frame.left}px`;
  el.style.bottom = `${Math.max(0, frame.bottom - box.bottom + (box.height - el.offsetHeight) / 2)}px`;
}

function nextAnnouncement() {
  const el = document.getElementById("announcement");
  const text = announcements.shift();
  announcing = text !== undefined;
  el.classList.toggle("hidden", !announcing);
  if (!announcing) return;
  el.textContent = text;
  placeAnnouncement(el);
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "";
  setTimeout(nextAnnouncement, ANNOUNCEMENT_MS);
}

function showWaveBanner(text, bossArrives = false, rankUpBanner = false) {
  const el = document.getElementById("wave-banner");
  const txt = document.getElementById("wave-banner-text");
  txt.textContent = text;
  el.classList.toggle("boss", bossArrives);
  el.classList.toggle("rankup", rankUpBanner);
  el.classList.remove("hidden");
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "";
  clearTimeout(showWaveBanner._t);
  showWaveBanner._t = setTimeout(() => el.classList.add("hidden"), bossArrives || rankUpBanner ? 1900 : 1300);
}

// =====================================================================
// Workshop — spend coins on permanent upgrades
// =====================================================================

function buyUpgrade(upgrade) {
  const level = upgradeLevel(upgrade.id);
  const cost = upgrade.costs[level];
  if (cost === undefined || save.coins < cost) return;
  save.coins -= cost;
  save.upgrades[upgrade.id] = level + 1;
  recordStat("upgrades", UPGRADES.reduce((total, u) => total + upgradeLevel(u.id), 0));
  writeSave();
  ensureAudio();
  playClankSound();
  renderWorkshop();
}

function renderWorkshop() {
  renderCollection();
  document.getElementById("workshop-coins").textContent = save.coins;
  document.getElementById("title-coins").textContent = save.coins;
  updateBookButton();
  renderPlayerLevel();
  const list = document.getElementById("workshop-list");
  list.replaceChildren();
  for (const upgrade of UPGRADES) {
    const level = upgradeLevel(upgrade.id);
    const cost = upgrade.costs[level];
    const button = document.createElement("button");
    button.className = "upgrade";
    button.disabled = cost === undefined || save.coins < cost;
    const name = document.createElement("b");
    name.textContent = `${upgrade.name} ${level}/${upgrade.costs.length}`;
    const text = document.createElement("span");
    text.textContent = upgrade.text;
    const price = document.createElement("em");
    price.textContent = cost === undefined ? "Max" : `${cost} coins`;
    button.append(name, text, price);
    button.addEventListener("click", () => buyUpgrade(upgrade));
    list.append(button);
  }
}

function openWorkshop() {
  renderWorkshop();
  document.getElementById("workshop-screen").classList.remove("hidden");
}

function closeWorkshop() {
  document.getElementById("workshop-screen").classList.add("hidden");
}

// =====================================================================
// Layout / resize
// =====================================================================

function canvasScale() {
  return Math.min(window.devicePixelRatio || 1, MAX_CANVAS_SCALE);
}

// A glow's blur counts screen pixels and ignores the canvas scale, so without
// this it would look wider on a canvas drawn at a lower scale. Sizes are given
// as they look at scale 3.
// Quality that adjusts itself. Glows are the costliest part of the art, so a
// phone that cannot keep up drops them for the rest of the session, and keeps
// everything else.
const LOW_FX_FRAME_MS = 22; // an average frame this slow counts as struggling (about 45 fps)
const LOW_FX_SECONDS = 2; // for this long in a row
let lowFx = false;
let frameMsAverage = 1000 / 60;
let strugglingFor = 0;

function watchFrameRate(frameMs, dt) {
  if (lowFx || gameState !== "playing" || document.hidden || frameMs > 250) return;
  frameMsAverage += (frameMs - frameMsAverage) * 0.05;
  strugglingFor = frameMsAverage > LOW_FX_FRAME_MS ? strugglingFor + dt : 0;
  if (strugglingFor >= LOW_FX_SECONDS) lowFx = true;
}

function glowBlur(blur) {
  return lowFx ? 0 : (blur * canvasScale()) / 3;
}

function fitCanvasDPR(canvas, cssW, cssH) {
  const dpr = canvasScale();
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function layoutBoardCanvas() {
  const wrap = document.getElementById("board-wrap");
  const rect = wrap.getBoundingClientRect();
  let w = Math.max(120, rect.width - 16);
  let h = w * (ROWS / COLS);
  if (h > rect.height - 16) {
    h = Math.max(120, rect.height - 16);
    w = h * (COLS / ROWS);
  }
  boardCssW = w;
  boardCssH = h;
  cellSize = boardCssW / COLS;
  boardCtx = fitCanvasDPR(boardCanvas, boardCssW, boardCssH);
}

function layoutBattleCanvas() {
  const rect = document.getElementById("battle-lane").getBoundingClientRect();
  battleCssW = Math.max(1, rect.width);
  battleCssH = Math.max(1, rect.height);
  battleCtx = fitCanvasDPR(battleCanvas, battleCssW, battleCssH);
}

// The effects canvas covers the whole game, so it needs to know where the
// board and the battle lane sit on it.
function layoutFxCanvas() {
  const frame = document.getElementById("app-frame").getBoundingClientRect();
  const board = boardCanvas.getBoundingClientRect();
  const lane = document.getElementById("battle-lane").getBoundingClientRect();
  fxCssW = frame.width;
  fxCssH = frame.height;
  boardOrigin = { x: board.left - frame.left, y: board.top - frame.top };
  laneRect = { x: lane.left - frame.left, y: lane.top - frame.top, w: lane.width, h: lane.height };
  fxCtx = fitCanvasDPR(fxCanvas, fxCssW, fxCssH);
}

function handleResize() {
  layoutBoardCanvas();
  layoutBattleCanvas();
  layoutFxCanvas();
}

// =====================================================================
// Game lifecycle / boot
// =====================================================================

function startNewRun() {
  ensureAudio();
  // Restart ends a run in progress, which still earns its coins.
  const restarted = RUN_SAVE_STATES.includes(gameState);
  // So does giving up a run saved last time.
  if (savedRun) {
    ({ wave, bossesBeaten, runTime } = savedRun.numbers);
    runStartWave = savedRun.numbers.runStartWave ?? 1;
    runCoinScale = savedRun.numbers.runCoinScale ?? 1;
    runBonusCoins = savedRun.numbers.runBonusCoins ?? 0;
    runKey = runKeyFor(savedRun.world, WEEKLY_EVENTS.find((e) => e.id === savedRun.event), savedRun.daily);
    runParts = savedRun.parts;
    runBanked = false;
  }
  const coinsFromRestart = restarted || savedRun ? bankRun() : 0;
  drag = null;
  peakRate = 0;
  sparkCharge = 0;
  chillFor = 0;
  steamFor = 0;
  runLowestShare = 1;
  marchers = [];
  clashes = [];
  enemyBacklog = 0;
  driverTurnsPerSec = DRIVER_BASE_TURNS_PER_SEC * (1 + upgradeLevel("speed") * SPEED_PER_LEVEL) * (heroIs("engineer") ? ENGINEER_SPEED : 1) * (1 + (heroLevel(save.hero) - 1) * HERO_LEVEL_SPEED);
  waveLead = WAVE_START_LEAD + upgradeLevel("recruits") * RECRUITS_LEAD_PER_LEVEL;
  nextWaveBonus = 0;
  lastTipAt = 0;
  hideTip();
  document.getElementById("pause-screen").classList.add("hidden");
  bossesBeaten = 0;
  enemiesBlasted = 0;
  usedOverdrive = false;
  runQuestCoins = 0;
  refreshDailyQuests();
  runTime = 0;
  bestWaveBeforeRun = bestWave;
  runBanked = false;
  runParts = {};
  offeredRewards = null;
  nextWavePlan = null;
  clearPaths();
  clearChests();
  hotStreak = 0;
  rerollsLeft = REROLLS_PER_RUN;
  // A daily run tried again after midnight becomes the new day's challenge.
  if (currentDaily && currentDaily.day !== todayKey()) {
    currentDaily = makeDaily(todayKey());
    currentWorld = currentDaily.world;
  }
  runRules = currentDaily ? currentDaily.rules : currentEvent ? [] : levelRules(currentWorld, worldLevel);
  runEasy = save.easy && !currentDaily && !currentEvent && worldLevel === 0;
  runCoinScale = currentDaily || currentEvent ? 1 : runLevel().coins;
  runBonusCoins = 0;
  runKey = runKeyFor(currentWorld, currentEvent, currentDaily);
  wavePace = null;
  strikeCount = 0;
  rustBlocked = false;
  strikeHeld = 0;
  pausedFromBuild = false;
  dealAccepted = false;
  activeDeal = null;
  dealPayout = 0;
  document.getElementById("build-bar").classList.add("hidden");
  lastClear = null;
  runEventWeek = currentEvent ? weekNumber() : 0;
  boss = null;
  comboCounts = { line: 0, block: 0, ring: 0 };
  armyRank = 0;
  eventRustIn = EVENT_RUST_SECONDS;
  endless = Boolean(currentDaily);
  enemyType = null;
  enemyReinforcePerSec = 0;
  enemyPowerIn = 0;
  frozenFor = 0;
  hideWorldClear();
  resetRally();
  waveEvent = null;
  lastEventId = null;
  eventReinforcePerSec = 0;
  blockedCells.clear();
  overdriveLeft = 0;
  overdriveCooldown = OVERDRIVE_START_COOLDOWN_SECONDS;
  particles = [];
  hitNumbers = [];
  fallers = [];
  bolts = [];
  shove = { player: 0, enemy: 0 };
  hitStop = 0;
  fallenBoss = null;
  strikeCooldown = 0;
  screenShake = 0;
  gearTray = [];
  gearDropAt = NO_GEAR_DROP;
  treasureAt = NO_GEAR_DROP;
  clearTreasureGoblin();
  wave = 1;
  waveTime = 0;
  playerPower = BASE_POWER * (1 + upgradeLevel("recruits") * RECRUITS_FIRST_WAVE_PER_LEVEL);
  enemyPower = BASE_POWER;
  totalArmyScore = 0;
  createBoard();
  for (let i = 0; i < upgradeLevel("startGears"); i++) placeGear(newGearType());
  if (heroIs("engineer")) placeGear("booster");
  const startGear = START_GEARS.find((item) => item.id === save.startGear)?.gear;
  if (startGear && bestEmptyCell()) placeGear(startGear);
  if (currentEvent?.id === "bombs") grid[DRIVER_ROW][DRIVER_COL + 1] = freshCell("bomb");
  runStartWave = nextRunHeadStart ? HEAD_START_WAVE : 1;
  if (nextRunHeadStart) {
    nextRunHeadStart = false;
    wave = HEAD_START_WAVE;
    for (let i = 0; i < HEAD_START_GEARS; i++) placeGear(newGearType());
    startWave();
  }

  document.getElementById("title-screen").classList.add("hidden");
  document.getElementById("gameover-screen").classList.add("hidden");
  document.getElementById("reward-screen").classList.add("hidden");
  clearTimeout(rewardTimer);
  document.getElementById("game-screen").classList.remove("hidden");
  gameState = "playing";
  updateFeatureButtons();
  handleResize();
  if (coinsFromRestart > 0) showToast(`+${coinsFromRestart} coins`);
  showWaveBanner(currentDaily ? "Daily challenge" : currentEvent ? currentEvent.name : runEasy ? `${WORLDS[currentWorld].name}: ${EASY_LEVEL.name}` : worldLevel ? `${WORLDS[currentWorld].name}: ${WORLD_LEVELS[worldLevel].name}` : WORLDS[currentWorld].name);
  saveRun();
}

let lastTime = 0;
function loop(now) {
  const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
  if (lastTime) watchFrameRate(now - lastTime, dt);
  lastTime = now;
  if (save.lessMotion) {
    screenShake = 0;
    hitStop = 0;
  }
  // Big hits freeze the game for a moment; effects keep moving through it.
  if (hitStop > 0) hitStop -= dt;
  else {
    update(dt);
    // Two steps rather than one long one, so the rules play out the same.
    if (save.speed === 2 && hitStop <= 0) update(dt);
  }
  updateMusic();
  updateScrapZone();
  renderGearTray();
  updateFx(dt);
  drawBoard();
  drawBattle();
  drawFx();
  requestAnimationFrame(loop);
}

function setupLanguage() {
  const lang = save.lang || (navigator.language?.toLowerCase().startsWith("th") ? "th" : "en");
  if (lang === "th") installTranslation(document.body);
}

function applyDisplaySettings() {
  document.documentElement.classList.toggle("big-text", save.bigText);
  document.documentElement.classList.toggle("less-motion", save.lessMotion);
}

function updateMoreButtons() {
  document.getElementById("language-btn").textContent = `Language: ${currentLang === "th" ? "Thai" : "English"}`;
  document.getElementById("big-text-btn").textContent = `Bigger text: ${save.bigText ? "on" : "off"}`;
  document.getElementById("color-blind-btn").textContent = `Colour-blind colours: ${save.colorBlind ? "on" : "off"}`;
  document.getElementById("less-motion-btn").textContent = `Less motion: ${save.lessMotion ? "on" : "off"}`;
}

function toggleSetting(name) {
  save[name] = !save[name];
  writeSave();
  applyDisplaySettings();
  updateMoreButtons();
  handleResize();
}

function switchLanguage() {
  save.lang = currentLang === "th" ? "en" : "th";
  writeSave();
  location.reload();
}

function openMore() {
  updateMoreButtons();
  document.getElementById("more-screen").classList.remove("hidden");
}

// A small picture drawn once with the game's own art.
function artIcon(draw) {
  const scale = canvasScale();
  const canvas = document.createElement("canvas");
  canvas.className = "art-icon";
  canvas.width = canvas.height = GUIDE_ICON_SIZE * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  // Gear art is sized from the board, which doesn't exist before the first run.
  const boardSize = cellSize;
  if (cellSize <= 0) cellSize = GUIDE_ICON_SIZE;
  draw(ctx);
  cellSize = boardSize;
  return canvas;
}

function gearIcon(type, rusted = false, level = 1) {
  return artIcon((ctx) => {
    const cell = freshCell(type);
    cell.rusted = rusted;
    cell.level = level;
    drawGearCell(ctx, GUIDE_ICON_SIZE / 2, GUIDE_ICON_SIZE / 2, GUIDE_ICON_SIZE - 4, cell);
  });
}

function mainGearIcon() {
  return artIcon((ctx) => {
    const cell = freshCell();
    Object.assign(cell, { driver: true, angle: QUARTER_TURN / 2, spin: 1 });
    drawDriverCell(ctx, GUIDE_ICON_SIZE / 2, GUIDE_ICON_SIZE / 2, GUIDE_ICON_SIZE - 4, cell);
  });
}

function enemyIcon(look) {
  return artIcon((ctx) => {
    ctx.translate(GUIDE_ICON_SIZE / 2, GUIDE_ICON_SIZE - 3);
    const fit = (GUIDE_ICON_SIZE - 8) / (31 * SOLDIER_LOOKS[look].size * battleArtScale());
    ctx.scale(fit, fit);
    drawSoldier(ctx, 0, 0, -1, look, "idle", 0);
  });
}

function bossIcon(kind) {
  return artIcon((ctx) => {
    ctx.translate(GUIDE_ICON_SIZE / 2, GUIDE_ICON_SIZE - 2);
    const fit = kind.final ? 0.5 : 0.7;
    ctx.scale(fit, fit);
    // drawBoss stands the boss 32 pixels past the front line it's given.
    drawBoss(ctx, { kind, attackIn: BOSS_ATTACK_SECONDS, hitFlash: 0, shield: 0 }, -32, 1000, 0);
  });
}

function emojiIcon(emoji) {
  const icon = document.createElement("span");
  icon.className = "emoji-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = emoji;
  return icon;
}

// A reward's picture: its gear if it gives one, otherwise its own icon.
function rewardIcon(reward) {
  return reward.gear ? gearIcon(reward.gear) : emojiIcon(REWARD_ICONS[reward.id] || "\u2728");
}

function guideRow(name, text, icon, tag) {
  const row = document.createElement("div");
  row.className = "guide-row";
  const words = document.createElement("div");
  words.className = "guide-words";
  const title = document.createElement("b");
  title.textContent = name;
  if (tag) {
    const label = document.createElement("small");
    label.className = tag.toLowerCase();
    label.textContent = tag;
    title.append(" ", label);
  }
  const detail = document.createElement("span");
  detail.textContent = text;
  words.append(title, detail);
  row.append(icon, words);
  return row;
}

const ENEMY_NOTES = {
  runner: "Goblin runners bring extra enemies, so win quickly.",
  brute: "Soldiers do less, but lightning and bombs hit at full strength.",
  shaman: "Keep rusting your gears, so tap them to fix them.",
  frost: "Freeze the main gear to half speed. Lightning thaws it.",
  imp: "Burn away gear progress, so win fast.",
};
const TREASURE_GOBLIN_NOTE = "Sometimes runs past carrying coins or a gear. Tap it before it escapes.";

// The guide is built from the same tables as the game, so it can't fall behind.
function guideSections() {
  const gearRewards = REWARDS.filter((reward) => reward.gear);
  return [
    ["Gears", [
      ["Main gear", "Turns by itself, and its one tooth drives all the gears around it. It can't be moved.", mainGearIcon()],
      ["Normal gear", "Fills in 4 hits, then sends 1 soldier. Merge two matching gears to level them up.", gearIcon("soldier")],
      ...gearRewards.map((reward) => [reward.name, reward.text, rewardIcon(reward)]),
      ["Elements", "Bomb gears are fire, Ice gears are ice and Spark gears are storm, and so are their fusions. Put two different ones side by side to make them react: fire + ice makes steam, fire + storm makes plasma, ice + storm makes a shatter.", emojiIcon("\u2668\uFE0F")],
      ["Super fusion", "Fuse two fused gears of the same level for a golden super gear: Cannon + Comet makes a Meteor, Storm + Blizzard a Tempest, Hermit + Engine a Fortress, Dynamo + Storm a Reactor.", gearIcon("meteor")],
      ["Gear fusion", "Drag a special gear onto a different one of the same level. If it has a purple ring, they fuse into a new, stronger gear. Find them all for your collection.", gearIcon("cannon")],
      ["Hot streak", "Win a wave quickly to build a streak, and each level spins the main gear faster. A slow wave ends it, but bosses and siege waves don't count.", emojiIcon("\u{1F525}")],
      ["Boss chests", "Beat a boss and pick one of three chests for coins or a strong gear. The others open too, so you'll see what you missed.", chestIcon(false, false)],
      ["Choose your path", "Every few waves, pick a route for the next one. Danger brings better rewards, or take the safe road.", emojiIcon(PATHS.elite.icon)],
      ["Treasure goblin", TREASURE_GOBLIN_NOTE, treasureGoblinIcon()],
      ["Free gear", "The only way to get more gears. Monsters drop them into the tray below the board, and every boss drops a level 2 gear at half health. A few are special gears. Drag one onto the board, or tap it.", gearIcon("soldier")],
      ["Rusted gear", "Stops working and blocks the gears behind it. Tap it to fix it.", gearIcon("soldier", true)],
    ]],
    ["Abilities", [
      ["Lightning", "Hits the enemy for free. Press it during a boss's glow, after holding it ready, to cancel the attack. It also thaws freezes.", emojiIcon("\u26A1")],
      ["Overdrive", "The main gear spins 3x faster for a few seconds, then needs to recharge.", emojiIcon("\u{1F525}")],
      ["Rally", "Holds arriving soldiers back. When the button says Charge!, press it to charge with 50% more.", emojiIcon("\u{1F4E3}")],
      ["Train", "Moves your army up a rank, so every new soldier counts for more.", emojiIcon("\u2694\uFE0F")],
    ]],
    ["Rewards", REWARDS.filter((reward) => !reward.gear).map((reward) => [reward.name, reward.text, rewardIcon(reward), reward.rarity === "epic" ? "Epic" : reward.rarity === "rare" ? "Rare" : ""])],
    ["Enemies", [
      ...Object.entries(ENEMY_NOTES).map(([id, note]) => [ENEMY_TYPES[id].name, note, enemyIcon(ENEMY_TYPES[id].look)]),
    ]],
    ["Bosses", [...BOSS_KINDS, ...Object.values(FINAL_BOSSES)].map((kind) => [kind.name, NEXT_WAVE_HINTS[kind.id], bossIcon(kind)])],
    ["Words to know", [
      ["Rank", "How strong each soldier is. Prices count in soldiers of your current rank.", emojiIcon("\u{1F396}\uFE0F")],
      ["Merge", "Drag a gear onto a matching one. Each level pays about 2.5x as much.", emojiIcon("\u2795")],
      ["Combo", "Three matching gears in a row, or four in a square, work better. Plain level 1 gears don't count.", emojiIcon("\u2728")],
      ["Chain", "A line of connected gears. Hits get weaker along it, and a Booster brings them back to full.", emojiIcon("\u{1F517}")],
      ["Scrap", "Drag a gear onto the bar that appears to remove it and get some soldiers back.", emojiIcon("\u267B\uFE0F")],
    ]],
  ];
}

function openGuide() {
  const list = document.getElementById("guide-list");
  list.replaceChildren();
  for (const [title, rows] of guideSections()) {
    const heading = document.createElement("h3");
    heading.textContent = title;
    list.append(heading, ...rows.map((row) => guideRow(...row)));
  }
  list.scrollTop = 0;
  document.getElementById("guide-screen").classList.remove("hidden");
}

// Built from the same tables as the guide, so nothing new can be left out. Each
// entry's picture is made only when it's shown. A starter is known from the start,
// as everyone meets it in the first few seconds.
function bookPages() {
  const rankNote = (rank) => (rank.fromWave === 1 ? "The first enemies you'll meet." : `Appear from wave ${rank.fromWave}, ${rank.strength}x as strong.`);
  const gearRewards = REWARDS.filter((reward) => reward.gear);
  return [
    { id: "enemies", name: "Enemies", coins: 50, entries: [
      ...ENEMY_RANKS.map((rank) => ({ id: `enemy:${rank.look}`, name: rank.plural, text: rankNote(rank), icon: () => enemyIcon(rank.look), starter: rank.fromWave === 1 })),
      ...Object.entries(ENEMY_NOTES).map(([id, note]) => ({ id: `enemy:${id}`, name: ENEMY_TYPES[id].name, text: note, icon: () => enemyIcon(ENEMY_TYPES[id].look) })),
      { id: "enemy:treasure", name: "Treasure goblin", text: TREASURE_GOBLIN_NOTE, icon: () => treasureGoblinIcon() },
    ] },
    { id: "bosses", name: "Bosses", coins: 100, entries: [...BOSS_KINDS, ...Object.values(FINAL_BOSSES)].map((kind) => ({ id: `boss:${kind.id}`, name: kind.name, text: NEXT_WAVE_HINTS[kind.id], icon: () => bossIcon(kind) })) },
    { id: "gears", name: "Gears", coins: 50, entries: [
      { id: "gear:soldier", name: "Normal gear", text: "Fills in 4 hits, then sends 1 soldier. Merge two matching gears to level them up.", icon: () => gearIcon("soldier"), starter: true },
      ...gearRewards.map((reward) => ({ id: `gear:${reward.gear}`, name: reward.name, text: reward.text, icon: () => rewardIcon(reward) })),
      ...FUSIONS.map((fusion) => ({ id: `gear:${fusion.gear}`, name: fusion.name, text: fusion.text, icon: () => gearIcon(fusion.gear) })),
    ] },
    { id: "rewards", name: "Rewards", coins: 100, entries: REWARDS.filter((reward) => !reward.gear).map((reward) => ({ id: `reward:${reward.id}`, name: reward.name, text: reward.text, icon: () => rewardIcon(reward) })) },
  ];
}

function bookKnows(entry) {
  return Boolean(entry.starter || save.collection[entry.id]);
}

function bookProgress(page) {
  return { have: page.entries.filter(bookKnows).length, total: page.entries.length };
}

function bookTotals() {
  return bookPages().reduce((sum, page) => {
    const { have, total } = bookProgress(page);
    return { have: sum.have + have, total: sum.total + total };
  }, { have: 0, total: 0 });
}

// The first time the player meets something. A finished page pays once.
function discover(id) {
  if (save.collection[id]) return;
  const page = bookPages().find((p) => p.entries.some((entry) => entry.id === id));
  const entry = page?.entries.find((e) => e.id === id);
  if (!entry || entry.starter) return;
  save.collection[id] = true;
  announce(`New in the book: ${entry.name}!`);
  const { have, total } = bookProgress(page);
  if (have === total && !save.collection[`page:${page.id}`]) {
    save.collection[`page:${page.id}`] = true;
    save.coins += page.coins;
    announce(`Page complete: ${page.name}! +${page.coins} coins`);
  }
  writeSave();
}

let bookPageIndex = 0;
function openBook(index = bookPageIndex) {
  bookPageIndex = index;
  const pages = bookPages();
  const page = pages[index];
  const tabs = document.getElementById("book-tabs");
  tabs.replaceChildren(...pages.map((p, i) => {
    const tab = document.createElement("button");
    tab.className = "book-tab";
    tab.classList.toggle("active", i === index);
    tab.textContent = p.name;
    tab.addEventListener("click", () => openBook(i));
    return tab;
  }));
  const { have, total } = bookProgress(page);
  document.getElementById("book-progress-fill").style.width = `${(have / total) * 100}%`;
  document.getElementById("book-progress-text").textContent = `${have} / ${total}`;
  document.getElementById("book-prize").textContent = save.collection[`page:${page.id}`] ? `Page complete! +${page.coins} coins earned` : `Complete this page: +${page.coins} coins`;
  const detail = document.getElementById("book-detail");
  const showDetail = (name, text) => {
    const title = document.createElement("b");
    title.textContent = name;
    const words = document.createElement("span");
    words.textContent = text;
    detail.replaceChildren(title, words);
  };
  showDetail("Tap an entry", have === total ? "You've found everything on this page." : "Keep playing to find the rest.");
  const grid = document.getElementById("book-grid");
  grid.replaceChildren(...page.entries.map((entry) => {
    const known = bookKnows(entry);
    const button = document.createElement("button");
    button.className = "book-entry";
    button.classList.toggle("unknown", !known);
    const art = document.createElement("span");
    art.className = known ? "book-art" : "book-art hidden-art";
    art.append(entry.icon());
    const name = document.createElement("small");
    name.textContent = known ? entry.name : "???";
    button.append(art, name);
    button.addEventListener("click", () => {
      for (const other of grid.children) other.classList.remove("selected");
      button.classList.add("selected");
      if (known) showDetail(entry.name, entry.text);
      else showDetail("???", "Not found yet. Keep playing to discover it.");
    });
    return button;
  }));
  grid.scrollTop = 0;
  document.getElementById("book-screen").classList.remove("hidden");
}

function updateBookButton() {
  const { have, total } = bookTotals();
  document.getElementById("title-book-btn").textContent = `Collection: ${have} / ${total}`;
}

function playedText(seconds) {
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

function openTrophies() {
  const list = document.getElementById("trophy-list");
  list.replaceChildren();
  const stars = WORLDS.reduce((total, world) => total + worldStars(world).filter(Boolean).length, 0);
  const tier = Math.max(0, ...WORLDS.map(clearedTier));
  const rows = [
    ["Best wave", bestWave],
    ["World stars", `${stars} / ${WORLDS.length * 3}`],
    ["Worlds cleared", `${clearedWorldCount()} / ${WORLDS.length}`],
    ["Hardest clear", tier ? WORLD_LEVELS[tier - 1].name : "None yet"],
    ["Waves won", statValue("waves")],
    ["Bosses beaten", statValue("bosses")],
    ["Attacks countered", statValue("counters")],
    ["Deals won", statValue("deals")],
    ["Gears merged", statValue("merges")],
    ["Combos made", statValue("combos")],
    ["Daily goals reached", statValue("dailyGoals")],
    ["Achievements", `${Object.keys(save.achievements).length} / ${ACHIEVEMENTS.length}`],
    ["Time played", playedText(save.playSeconds)],
  ];
  for (const [name, value] of rows) {
    const row = document.createElement("div");
    row.className = "trophy-row";
    const label = document.createElement("span");
    label.textContent = name;
    const number = document.createElement("b");
    number.textContent = String(value);
    row.append(label, number);
    list.append(row);
  }
  const heading = document.createElement("h3");
  heading.textContent = "Heroes";
  list.append(heading);
  for (const hero of HEROES.filter((h) => ownsItem("hero", h))) {
    const row = document.createElement("div");
    row.className = "trophy-row";
    const label = document.createElement("span");
    label.textContent = hero.name;
    const number = document.createElement("b");
    number.textContent = `Level ${heroLevel(hero.id)}`;
    row.append(label, number);
    list.append(row);
  }
  const worldHeading = document.createElement("h3");
  worldHeading.textContent = "Worlds";
  list.append(worldHeading);
  for (const world of WORLDS) {
    const row = document.createElement("div");
    row.className = "trophy-row";
    const label = document.createElement("span");
    label.textContent = world.name;
    const number = document.createElement("b");
    number.textContent = starsText(worldStars(world));
    row.append(label, number);
    list.append(row);
  }
  document.getElementById("trophy-screen").classList.remove("hidden");
}

function init() {
  setupLanguage();
  applyDisplaySettings();
  boardCanvas = document.getElementById("board-canvas");
  battleCanvas = document.getElementById("battle-canvas");
  fxCanvas = document.getElementById("fx-canvas");

  if (bestWave > 1) {
    document.getElementById("best-wave").textContent = bestWave;
    document.getElementById("best-line").classList.remove("hidden");
  }

  checkAwayEarnings();
  savedRun = loadRunSave();
  updateContinueButton();
  document.getElementById("continue-btn").addEventListener("click", continueRun);
  document.getElementById("play-btn").addEventListener("click", pressPlay);
  document.getElementById("next-world-btn").addEventListener("click", goToNextWorld);
  document.getElementById("harder-btn").addEventListener("click", tryHarderLevel);
  document.getElementById("keep-going-btn").addEventListener("click", keepGoing);
  document.getElementById("clear-worlds-btn").addEventListener("click", backToWorlds);
  document.getElementById("gameover-worlds-btn").addEventListener("click", backToWorlds);
  document.getElementById("worlds-close-btn").addEventListener("click", () => {
    document.getElementById("worlds-screen").classList.add("hidden");
  });
  document.getElementById("retry-btn").addEventListener("click", startNewRun);
  document.getElementById("restart-btn").addEventListener("click", startNewRun);
  document.getElementById("home-btn").addEventListener("click", goHome);
  document.getElementById("strike-btn").addEventListener("click", pressLightning);
  document.getElementById("overdrive-btn").addEventListener("click", activateOverdrive);
  document.getElementById("rally-btn").addEventListener("click", toggleRally);
  document.getElementById("train-btn").addEventListener("click", trainArmy);
  document.getElementById("mute-btn").addEventListener("click", () => setMuted(!save.muted));
  document.getElementById("speed-btn").addEventListener("click", toggleSpeed);
  document.getElementById("music-btn").addEventListener("click", toggleMusic);
  document.getElementById("vibrate-btn").addEventListener("click", toggleVibrate);
  document.getElementById("reroll-btn").addEventListener("click", rerollRewards);
  document.getElementById("skip-btn").addEventListener("click", skipReward);
  document.getElementById("deal-btn").addEventListener("click", toggleDeal);
  const closeScreen = (id) => () => document.getElementById(id).classList.add("hidden");
  document.getElementById("title-more-btn").addEventListener("click", openMore);
  document.getElementById("title-book-btn").addEventListener("click", () => openBook());
  document.getElementById("book-close-btn").addEventListener("click", closeScreen("book-screen"));
  document.getElementById("more-close-btn").addEventListener("click", closeScreen("more-screen"));
  document.getElementById("language-btn").addEventListener("click", switchLanguage);
  document.getElementById("big-text-btn").addEventListener("click", () => toggleSetting("bigText"));
  document.getElementById("color-blind-btn").addEventListener("click", () => toggleSetting("colorBlind"));
  document.getElementById("less-motion-btn").addEventListener("click", () => toggleSetting("lessMotion"));
  document.getElementById("guide-btn").addEventListener("click", openGuide);
  document.getElementById("reward-guide-btn").addEventListener("click", openGuide);
  document.getElementById("pause-guide-btn").addEventListener("click", openGuide);
  document.getElementById("guide-close-btn").addEventListener("click", closeScreen("guide-screen"));
  document.getElementById("trophy-btn").addEventListener("click", openTrophies);
  document.getElementById("trophy-close-btn").addEventListener("click", closeScreen("trophy-screen"));
  updateFeatureButtons();
  document.getElementById("build-start-btn").addEventListener("click", () => {
    if (gameState === "building") beginWave();
  });
  document.getElementById("share-btn").addEventListener("click", shareRun);
  document.getElementById("away-claim-btn").addEventListener("click", () => document.getElementById("away-screen").classList.add("hidden"));
  document.getElementById("title-backup-btn").addEventListener("click", openBackup);
  document.getElementById("backup-close-btn").addEventListener("click", () => document.getElementById("backup-screen").classList.add("hidden"));
  document.getElementById("download-backup-btn").addEventListener("click", downloadBackup);
  document.getElementById("copy-backup-btn").addEventListener("click", copyBackup);
  document.getElementById("backup-file").addEventListener("change", loadBackupFile);
  document.getElementById("restore-btn").addEventListener("click", restoreBackup);
  document.getElementById("backup-text").addEventListener("input", () => {
    delete document.getElementById("restore-btn").dataset.armed;
    document.getElementById("restore-btn").textContent = "Restore from text above";
  });
  // Lets the game open with no connection. Not available when opened as a local file.
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  updateSettingButtons();
  document.getElementById("tip-ok-btn").addEventListener("click", closeTip);
  document.getElementById("pause-btn").addEventListener("click", pauseGame);
  document.getElementById("resume-btn").addEventListener("click", resumeGame);
  // A call or a switch to another app shouldn't lose the run.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      pauseGame();
      leavingPage();
    } else {
      checkAwayEarnings();
    }
  });
  window.addEventListener("pagehide", leavingPage);
  document.getElementById("how-to-play-btn").addEventListener("click", replayTips);
  document.getElementById("title-quests-btn").addEventListener("click", openQuests);
  document.getElementById("gameover-quests-btn").addEventListener("click", openQuests);
  document.getElementById("quests-close-btn").addEventListener("click", closeQuests);
  document.getElementById("daily-claim-btn").addEventListener("click", claimDailyReward);
  applyGearSkin();
  fillQuests();
  refreshDailyQuests();
  writeSave();
  if (save.dailyStreak > 0 || statValue("runs") > 0) showDailyReward();
  document.getElementById("title-workshop-btn").addEventListener("click", openWorkshop);
  document.getElementById("gameover-workshop-btn").addEventListener("click", openWorkshop);
  document.getElementById("workshop-close-btn").addEventListener("click", closeWorkshop);
  updateMuteButton();
  renderWorkshop();

  wireBoardInput();
  window.addEventListener("resize", handleResize);
  window.addEventListener("orientationchange", handleResize);

  requestAnimationFrame(loop);
}

document.addEventListener("DOMContentLoaded", init);
