// Ghost names come from the player's id, never from typed text, so there is
// nothing to moderate. public/game.js has the same lists and makes the same
// name, so a player sees the name others will see.
"use strict";

const NAME_ADJECTIVES = ["Brave", "Rusty", "Shiny", "Swift", "Mighty", "Clever", "Steady", "Lucky", "Bold", "Golden", "Iron", "Copper", "Quick", "Jolly", "Silent", "Stormy"];
const NAME_NOUNS = ["Cog", "Gear", "Sprocket", "Bolt", "Spring", "Piston", "Wheel", "Lever", "Rivet", "Spanner", "Crank", "Valve", "Anvil", "Hammer", "Engine", "Dynamo"];

function ghostName(playerId) {
  const n = parseInt(playerId.slice(0, 8), 16);
  return `${NAME_ADJECTIVES[n % 16]} ${NAME_NOUNS[(n >>> 4) % 16]} ${(n >>> 8) % 100}`;
}

module.exports = { ghostName, NAME_ADJECTIVES, NAME_NOUNS };
