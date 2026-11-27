#!/usr/bin/env node
/**
 * Import house JSON (+ interest.json + rankings.json) into the SQLite houses DB.
 *
 * Usage:
 *   npm run houses:import
 *   npm run houses:import -- --force
 *   node scripts/houses-import.js --force
 *
 * By default this is a no-op when the houses table already has rows
 * (same as the startup seed). Pass --force to wipe houses/price_history
 * and re-import from disk.
 */
const {
  importHousesFromDisk,
  maybeImportHousesFromDisk,
  closeHousesDb,
  getHousesDbPath,
  countHouses,
} = require("../lib/houses-db");

function main() {
  const force = process.argv.includes("--force") || process.argv.includes("-f");

  try {
    const result = force
      ? importHousesFromDisk({ force: true, actor: "cli" })
      : maybeImportHousesFromDisk({ actor: "cli" });

    console.log(`Houses DB: ${getHousesDbPath()}`);
    if (!result.imported) {
      console.log(
        `Skipped import (${result.reason || "already_has_houses"}). ` +
          `House rows: ${result.houseCount ?? countHouses({ includeDeleted: true })}. ` +
          `Re-run with --force to replace.`
      );
      return;
    }
    console.log(
      `Imported ${result.houseCount} houses, ${result.pricePoints} price points, ` +
        `${result.rankings} rankings, ` +
        `${result.interest.notInterested} not-interested, ` +
        `${result.interest.pendingReactivation} pending reactivation.`
    );
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  } finally {
    closeHousesDb();
  }
}

main();
