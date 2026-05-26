import fs from 'fs';
import path from 'path';
import { parseCommandMessage } from './commands/index.js';
import * as world from './library/world.js';
import { FOOD_MOBS, GENERIC_WOOD_TARGET, isGenericWoodTarget, isWoodBlock, isWoodValidForDimension, WOOD_BLOCKS, woodBlocksForBiome } from './world_model.js';

const WOOD_TYPES = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'crimson', 'warped'];
const PICKAXES = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'];
const AXES = ['wooden_axe', 'stone_axe', 'iron_axe', 'diamond_axe', 'netherite_axe'];
const HOES = ['wooden_hoe', 'stone_hoe', 'iron_hoe', 'diamond_hoe', 'netherite_hoe'];
const MELEE_WEAPONS = ['wooden_sword', 'stone_sword', 'iron_sword', 'diamond_sword', 'netherite_sword', 'wooden_axe', 'stone_axe', 'iron_axe', 'diamond_axe', 'netherite_axe'];
const TOOL_TIERS = ['wooden', 'stone', 'iron', 'diamond', 'netherite'];
const ARMOR_PIECES = ['helmet', 'chestplate', 'leggings', 'boots'];
const ARMOR_SLOTS = [5, 6, 7, 8];
const BEDS = ['white_bed', 'orange_bed', 'magenta_bed', 'light_blue_bed', 'yellow_bed', 'lime_bed', 'pink_bed', 'gray_bed', 'light_gray_bed', 'cyan_bed', 'purple_bed', 'blue_bed', 'brown_bed', 'green_bed', 'red_bed', 'black_bed'];
const WOOL_ITEMS = ['white_wool', 'orange_wool', 'magenta_wool', 'light_blue_wool', 'yellow_wool', 'lime_wool', 'pink_wool', 'gray_wool', 'light_gray_wool', 'cyan_wool', 'purple_wool', 'blue_wool', 'brown_wool', 'green_wool', 'red_wool', 'black_wool'];
const RAW_FOOD = ['beef', 'porkchop', 'mutton', 'chicken', 'rabbit', 'cod', 'salmon'];
const TRADE_GOODS = ['emerald', 'wheat', 'carrot', 'potato', 'beetroot', 'paper', 'stick', 'string', 'flint', 'clay_ball', 'coal', 'charcoal'];
const SEEDS = ['wheat_seeds', 'beetroot_seeds', 'pumpkin_seeds', 'melon_seeds'];
const FARM_BLOCKS = ['farmland', 'wheat', 'carrots', 'potatoes', 'beetroots'];
const HOSTILE_MOBS = [
    'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'drowned', 'husk', 'stray',
    'witch', 'slime', 'phantom', 'pillager', 'vindicator', 'evoker', 'ravager', 'enderman'
];
const READY_FOOD = [
    'cooked_beef',
    'cooked_porkchop',
    'cooked_mutton',
    'cooked_chicken',
    'cooked_rabbit',
    'cooked_cod',
    'cooked_salmon',
    'bread',
    'apple',
    'carrot',
    'baked_potato',
    'potato',
    'beetroot',
    'melon_slice',
    'sweet_berries',
    'pumpkin_pie',
    'mushroom_stew',
    'rabbit_stew'
];
const EDIBLE_NOW = [...READY_FOOD, 'beef', 'porkchop', 'mutton', 'rabbit', 'cod', 'salmon'];
const ANY_FOOD_UNIT = Array.from(new Set([...EDIBLE_NOW, ...RAW_FOOD]));
const SAFE_QUERY_COMMANDS = new Set(['!stats', '!inventory', '!nearbyBlocks', '!entities', '!craftable', '!getCraftingPlan']);

function unique(items) {
    return [...new Set(items.filter(Boolean))];
}

function countItems(inventory, predicate) {
    return Object.entries(inventory)
        .filter(([name]) => predicate(name))
        .reduce((total, [, count]) => total + count, 0);
}

function countNamed(inventory, names) {
    return names.reduce((total, item) => total + (inventory[item] || 0), 0);
}

function countPlanks(inventory) {
    return countItems(inventory, name => name.endsWith('_planks'));
}

function countLogs(inventory) {
    return countItems(inventory, name => isWoodBlock(name) || name.endsWith('_wood'));
}

function hasAny(inventory, itemNames) {
    return itemNames.some(item => (inventory[item] || 0) > 0);
}

function toolTier(itemName) {
    const tier = TOOL_TIERS.find(prefix => itemName.startsWith(`${prefix}_`));
    return tier ? TOOL_TIERS.indexOf(tier) : -1;
}

function highestToolTier(inventory, itemNames) {
    return Math.max(-1, ...itemNames
        .filter(item => (inventory[item] || 0) > 0)
        .map(toolTier));
}

function hasBed(inventory) {
    return BEDS.some(bed => (inventory[bed] || 0) > 0);
}

function hasChest(inventory) {
    return (inventory.chest || 0) > 0 || (inventory.trapped_chest || 0) > 0 || (inventory.barrel || 0) > 0;
}

function getEquippedArmorNames(bot) {
    return ARMOR_SLOTS
        .map(slot => bot?.inventory?.slots?.[slot]?.name)
        .filter(Boolean);
}

function isArmorName(name) {
    return ARMOR_PIECES.some(piece => String(name || '').endsWith(`_${piece}`));
}

function countInventoryArmorPieces(inventory) {
    return Object.keys(inventory).filter(isArmorName).length;
}

function countEquippedArmorPieces(bot) {
    return getEquippedArmorNames(bot).filter(isArmorName).length;
}

function hasUnequippedArmor(inventory, bot) {
    return countInventoryArmorPieces(inventory) > 0 && countEquippedArmorPieces(bot) < 4;
}

function isBlockNearby(bot, blockNames, range = 16) {
    if (!bot?.entity) return false;
    return blockNames.some(name => world.getNearestBlock(bot, name, range) !== null);
}

function countArmorPieces(inventory) {
    return countInventoryArmorPieces(inventory);
}

function getPlankRecipeFromInventory(inventory) {
    for (const wood of WOOD_TYPES) {
        if ((inventory[`${wood}_log`] || 0) > 0 ||
            (inventory[`${wood}_wood`] || 0) > 0 ||
            (inventory[`${wood}_stem`] || 0) > 0 ||
            (inventory[`${wood}_hyphae`] || 0) > 0) {
            return `${wood}_planks`;
        }
    }
    return 'oak_planks';
}

function firstItemInInventory(inventory, names) {
    return names.find(name => (inventory[name] || 0) > 0) || null;
}

function hasFuel(inventory) {
    return ['coal', 'charcoal', 'blaze_rod', 'coal_block', 'lava_bucket'].some(item => (inventory[item] || 0) > 0) ||
        countLogs(inventory) > 0 ||
        countPlanks(inventory) > 0;
}

function getNearbyEntityNames(agent, range = 24) {
    if (!agent?.bot?.entity) return [];
    return world.getNearbyEntities(agent.bot, range)
        .map(entity => entity?.name)
        .filter(Boolean);
}

function getNearbyAdultVillager(agent, range = 24) {
    if (!agent?.bot?.entity) return null;
    const villager = world.getNearbyEntities(agent.bot, range)
        .find(entity => entity?.name === 'villager' && entity?.metadata?.[16] !== 1);
    if (!villager) return null;

    return {
        id: villager.id,
        profession: world.getVillagerProfession(villager)
    };
}

function getRecentEventText(agent) {
    return (agent?.memory_bank?.getRecentEvents?.(12) || [])
        .join('\n')
        .toLowerCase();
}

function didRecently(agent, needle, count = 6) {
    return (agent?.memory_bank?.getRecentEvents?.(count) || [])
        .some(event => String(event || '').toLowerCase().includes(needle.toLowerCase()));
}

function failedRecently(agent, actionKey, needle = '', threshold = 2) {
    const count = agent?.memory_bank?.failedAttempts?.[actionKey] || 0;
    if (count >= threshold) return true;
    if (!needle) return false;
    const events = (agent?.memory_bank?.getRecentEvents?.(12) || []).map(event => String(event || '').toLowerCase());
    for (const event of events) {
        if (event.includes('food search area changed')) return false;
        if (event.includes(needle.toLowerCase())) return true;
    }
    return false;
}

function tradedRecently(agent, villagerId) {
    const events = getRecentEventText(agent);
    return events.includes(`successfully auto-traded with villager ${villagerId}`) ||
        events.includes('no safe affordable villager trade found');
}

function makeTask(id, text, command, status = 'pending', reason = '') {
    return { id, text, command, status, reason };
}

function withActive(tasks) {
    const firstPending = tasks.find(task => task.status === 'pending');
    if (firstPending) firstPending.status = 'active';
    return tasks;
}

function getFacts(agent) {
    agent?.world_model?.updateFromAgent?.();
    const inventory = agent?.bot?.inventory ? world.getInventoryCounts(agent.bot) : {};
    const nearbyEntities = getNearbyEntityNames(agent, 24);
    const nearbyHostiles = nearbyEntities.filter(name => HOSTILE_MOBS.includes(name));
    const preferredWoodTarget = agent?.world_model?.getPreferredWoodTarget?.() || WOOD_BLOCKS[0];
    const preferredFoodMob = agent?.world_model?.getPreferredFoodMob?.() || null;
    const nearbyVillager = getNearbyAdultVillager(agent, 24);
    const tradeGoods = countNamed(inventory, TRADE_GOODS);
    const equippedArmorCount = countEquippedArmorPieces(agent?.bot);
    const inventoryArmorCount = countArmorPieces(inventory);
    const facts = {
        inventory,
        planks: countPlanks(inventory),
        logs: countLogs(inventory),
        sticks: inventory.stick || 0,
        cobblestone: inventory.cobblestone || 0,
        torches: inventory.torch || 0,
        coal: inventory.coal || 0,
        charcoal: inventory.charcoal || 0,
        rawIron: inventory.raw_iron || 0,
        ironIngot: inventory.iron_ingot || 0,
        diamond: inventory.diamond || 0,
        readyFood: countNamed(inventory, EDIBLE_NOW),
        rawFood: countNamed(inventory, RAW_FOOD),
        emerald: inventory.emerald || 0,
        tradeGoods,
        seeds: countNamed(inventory, SEEDS),
        wool: countNamed(inventory, WOOL_ITEMS),
        readyFoodItem: firstItemInInventory(inventory, EDIBLE_NOW),
        rawFoodItem: firstItemInInventory(inventory, RAW_FOOD),
        hasFurnace: (inventory.furnace || 0) > 0 || isBlockNearby(agent.bot, ['furnace', 'blast_furnace', 'smoker']),
        hasCraftingTable: (inventory.crafting_table || 0) > 0 || isBlockNearby(agent.bot, ['crafting_table']),
        craftingTablePlaced: isBlockNearby(agent.bot, ['crafting_table']),
        hasFuel: hasFuel(inventory),
        highestPickaxeTier: highestToolTier(inventory, PICKAXES),
        highestAxeTier: highestToolTier(inventory, AXES),
        highestHoeTier: highestToolTier(inventory, HOES),
        hasMeleeWeapon: hasAny(inventory, MELEE_WEAPONS),
        armorCount: inventoryArmorCount + equippedArmorCount,
        inventoryArmorCount,
        equippedArmorCount,
        hasUnequippedArmor: hasUnequippedArmor(inventory, agent?.bot),
        hasBed: hasBed(inventory),
        hasChest: hasChest(inventory),
        health: Math.round(agent?.bot?.health ?? 20),
        hunger: Math.round(agent?.bot?.food ?? 20),
        recentlyDamaged: Date.now() - (agent?.bot?.lastDamageTime || 0) < 5000,
        timeOfDay: agent?.bot?.time?.timeOfDay ?? 6000,
        nearbyEntities,
        nearbyHostiles,
        preferredWoodTarget,
        preferredFoodMob,
        nearbyWood: agent?.world_model?.state?.current_area?.nearby?.wood || [],
        biome: agent?.world_model?.state?.current_area?.biome || 'unknown',
        dimension: agent?.world_model?.state?.current_area?.dimension || agent?.bot?.game?.dimension || 'overworld',
        nearbyFoodMob: FOOD_MOBS.find(mob => nearbyEntities.includes(mob)) || null,
        nearbyVillagerId: nearbyVillager?.id || null,
        nearbyVillagerProfession: nearbyVillager?.profession || null,
        hasBase: Boolean(agent?.memory_bank?.recallPlace?.('base') || agent?.memory_bank?.recallPlace?.('home')),
        chestPlaced: isBlockNearby(agent.bot, ['chest', 'barrel', 'trapped_chest'], 16),
        torchPlaced: isBlockNearby(agent.bot, ['torch', 'wall_torch'], 8),
        furnacePlaced: isBlockNearby(agent.bot, ['furnace', 'blast_furnace', 'smoker']),
        hasFarm: isBlockNearby(agent.bot, FARM_BLOCKS, 24)
    };

    facts.foodUnits = countNamed(inventory, ANY_FOOD_UNIT);
    facts.foodSecure = facts.readyFood >= 4 || facts.foodUnits >= 6;
    facts.needsImmediateFood = facts.hunger <= 12 || facts.readyFood === 0;
    facts.isNight = facts.timeOfDay >= 12000;
    facts.tradeReady = Boolean(facts.nearbyVillagerId && (facts.emerald > 0 || facts.tradeGoods >= 8));
    return facts;
}

function selectFoodSearchCommand(agent) {
    const preferred = agent?.world_model?.getPreferredFoodMob?.();
    if (preferred && !failedRecently(agent, `!searchForEntity:${preferred}`, `could not find any ${preferred}`)) {
        return `!searchForEntity("${preferred}", 64)`;
    }

    for (const mob of FOOD_MOBS) {
        if (!failedRecently(agent, `!searchForEntity:${mob}`, `could not find any ${mob}`)) {
            return `!searchForEntity("${mob}", 64)`;
        }
    }

    if (!getRecentEventText(agent).includes('!moveaway')) {
        return '!moveAway(48)';
    }

    return '!entities';
}

function selectWoodCommand(agent, facts, quantity = 3) {
    const dimension = facts.dimension || agent?.bot?.game?.dimension || 'overworld';
    const biomeWood = woodBlocksForBiome(facts.biome, dimension)
        .filter(name => isWoodBlock(name) && isWoodValidForDimension(name, dimension));
    const hasBiomeWood = biomeWood.length > 0;
    const validDimensionWood = name => isWoodBlock(name) && isWoodValidForDimension(name, dimension);
    const isUsableForCurrentBiome = name =>
        isGenericWoodTarget(name) ||
        !hasBiomeWood ||
        biomeWood.includes(name) ||
        (facts.nearbyWood || []).includes(name);
    const candidates = unique([
        ...((facts.nearbyWood || []).filter(validDimensionWood)),
        facts.preferredWoodTarget,
        agent?.world_model?.getPreferredWoodTarget?.(),
        ...biomeWood
    ]).filter(name => validDimensionWood(name) && isUsableForCurrentBiome(name));

    const collectTarget = candidates.find(block => !failedRecently(agent, `!collectBlocks:${block}`));
    if (collectTarget) {
        return `!collectBlocks("${collectTarget}", ${quantity})`;
    }

    const searchTarget = candidates.find(block => !failedRecently(agent, `!searchForBlock:${block}`));
    if (searchTarget) {
        return `!searchForBlock("${searchTarget}", 64)`;
    }

    if (!failedRecently(agent, `!collectBlocks:${GENERIC_WOOD_TARGET}`)) {
        return `!collectBlocks("${GENERIC_WOOD_TARGET}", ${quantity})`;
    }
    if (!failedRecently(agent, `!searchForBlock:${GENERIC_WOOD_TARGET}`)) {
        return `!searchForBlock("${GENERIC_WOOD_TARGET}", 64)`;
    }

    if (!getRecentEventText(agent).includes('wood search area changed')) {
        return '!moveAway(48)';
    }

    return '!nearbyBlocks';
}

function requiredPlanksForWoodenPickaxe(facts) {
    const tablePlanks = facts.hasCraftingTable ? 0 : 4;
    const toolAndStickPlanks = facts.sticks >= 2 ? 3 : 5;
    return tablePlanks + toolAndStickPlanks;
}

function buildWoodenPickaxePlan(agent, facts) {
    const plankRecipe = getPlankRecipeFromInventory(facts.inventory);
    const requiredPlanks = requiredPlanksForWoodenPickaxe(facts);
    const woodPotential = facts.planks + (facts.logs * 4);
    const missingWood = Math.max(1, Math.ceil((requiredPlanks - woodPotential) / 4));
    const woodCommand = selectWoodCommand(agent, facts, Math.max(3, missingWood));
    return {
        objective_id: 'wooden_pickaxe',
        objective: 'Make the first wooden pickaxe.',
        reason: 'Without a pickaxe the bot cannot enter the normal survival progression.',
        microtasks: withActive([
            makeTask('wood', `Collect enough usable wood for table, sticks, and pickaxe (${facts.preferredWoodTarget}).`, woodCommand, woodPotential >= requiredPlanks ? 'done' : 'pending'),
            makeTask('planks', `Turn logs into planks until at least ${requiredPlanks} planks are available.`, `!craftRecipe("${plankRecipe}", 1)`, facts.planks >= requiredPlanks ? 'done' : (facts.logs > 0 ? 'pending' : 'blocked'), 'Need more logs before more planks.'),
            makeTask('table', 'Have one crafting table.', '!craftRecipe("crafting_table", 1)', facts.hasCraftingTable ? 'done' : (facts.planks >= 4 ? 'pending' : 'blocked'), 'Need 4 planks before crafting a table.'),
            makeTask('sticks', 'Make exactly the sticks needed for the tool.', '!craftRecipe("stick", 1)', facts.sticks >= 2 ? 'done' : (facts.planks >= 2 ? 'pending' : 'blocked'), 'Need 2 planks before crafting sticks.'),
            makeTask('pickaxe', 'Craft the wooden pickaxe. The craft command will place and recover the table if needed.', '!craftRecipe("wooden_pickaxe", 1)', facts.highestPickaxeTier >= toolTier('wooden_pickaxe') ? 'done' : (facts.hasCraftingTable && facts.planks >= 3 && facts.sticks >= 2 ? 'pending' : 'blocked'), 'Need crafting table access, 3 planks, and 2 sticks.'),
            makeTask('axe', 'Craft a wooden axe to avoid punching wood.', '!craftRecipe("wooden_axe", 1)', facts.highestAxeTier >= toolTier('wooden_axe') ? 'done' : (facts.hasCraftingTable && facts.planks >= 3 && facts.sticks >= 2 ? 'pending' : 'blocked'), 'Need crafting table access and materials.')
        ])
    };
}

function buildStonePickaxePlan(agent, facts) {
    const woodCommand = selectWoodCommand(agent, facts, 2);
    const plankRecipe = getPlankRecipeFromInventory(facts.inventory);
    return {
        objective_id: 'stone_pickaxe',
        objective: 'Upgrade to practical stone tools.',
        reason: 'Stone tools unlock faster gathering, furnace, coal, and iron progression.',
        microtasks: withActive([
            makeTask('stone', 'Mine enough stone/cobblestone for stone tools.', '!collectBlocks("stone", 6)', facts.cobblestone >= 6 || (facts.highestPickaxeTier >= toolTier('stone_pickaxe') && facts.highestAxeTier >= toolTier('stone_axe')) ? 'done' : (facts.highestPickaxeTier >= toolTier('wooden_pickaxe') ? 'pending' : 'blocked'), 'Need a wooden pickaxe before mining stone.'),
            makeTask('get_stick_wood', 'Collect a tiny wood buffer if stone tools still need sticks.', woodCommand, facts.sticks >= 2 || facts.planks > 0 || facts.logs > 0 ? 'done' : 'pending'),
            makeTask('make_planks', 'Convert logs to planks for sticks if needed.', `!craftRecipe("${plankRecipe}", 1)`, facts.sticks >= 2 || facts.planks >= 2 ? 'done' : (facts.logs > 0 ? 'pending' : 'blocked'), 'Need logs before planks.'),
            makeTask('sticks', 'Make sticks only if stone tools still need them.', '!craftRecipe("stick", 1)', facts.sticks >= 2 ? 'done' : (facts.planks >= 2 ? 'pending' : 'blocked'), 'Need planks before sticks.'),
            makeTask('stone_pickaxe', 'Craft the stone pickaxe.', '!craftRecipe("stone_pickaxe", 1)', facts.highestPickaxeTier >= toolTier('stone_pickaxe') ? 'done' : (facts.cobblestone >= 3 && facts.sticks >= 2 ? 'pending' : 'blocked'), 'Need 3 cobblestone and 2 sticks.'),
            makeTask('stone_axe', 'Craft a stone axe so wood is no longer punched by hand.', '!craftRecipe("stone_axe", 1)', facts.highestAxeTier >= toolTier('stone_axe') ? 'done' : (facts.cobblestone >= 3 && facts.sticks >= 2 ? 'pending' : 'blocked'), 'Need 3 cobblestone and 2 sticks.')
        ])
    };
}

function buildFoodPlan(agent, facts) {
    const tasks = [];
    const woodCommand = selectWoodCommand(agent, facts, 2);

    tasks.push(makeTask(
        'eat',
        'Eat ready food if hunger is low.',
        facts.readyFoodItem ? `!consume("${facts.readyFoodItem}")` : '!inventory',
        facts.hunger > 16 || !facts.readyFoodItem ? 'done' : 'pending'
    ));

    tasks.push(makeTask(
        'cook_raw_food',
        'Cook raw food before more searching if possible.',
        facts.rawFoodItem ? `!smeltItem("${facts.rawFoodItem}", ${Math.min(3, facts.rawFood)})` : '!inventory',
        facts.rawFood === 0 || !facts.hasFurnace || !facts.hasFuel ? 'done' : 'pending'
    ));

    tasks.push(makeTask(
        'make_furnace',
        'Craft a furnace if raw food exists and no furnace is available.',
        '!craftRecipe("furnace", 1)',
        facts.rawFood === 0 || facts.hasFurnace ? 'done' : (facts.cobblestone >= 8 ? 'pending' : 'blocked'),
        facts.highestPickaxeTier < toolTier('wooden_pickaxe') ? 'Need a wooden pickaxe before mining cobblestone for a furnace.' : (facts.cobblestone < 8 ? 'Need 8 cobblestone before a furnace.' : '')
    ));

    tasks.push(makeTask(
        'get_furnace_stone',
        'Collect cobblestone for a furnace when food needs cooking.',
        '!collectBlocks("stone", 8)',
        facts.rawFood === 0 || facts.hasFurnace || facts.cobblestone >= 8 ? 'done' : (facts.highestPickaxeTier >= toolTier('wooden_pickaxe') ? 'pending' : 'blocked'),
        'Need a wooden pickaxe before mining stone.'
    ));

    tasks.push(makeTask(
        'get_cooking_fuel',
        'Get a small fuel item for cooking raw food.',
        woodCommand,
        facts.rawFood === 0 || !facts.hasFurnace || facts.hasFuel ? 'done' : 'pending'
    ));

    tasks.push(makeTask(
        'make_hunting_sticks',
        'Make sticks for a basic hunting weapon if an animal is nearby.',
        '!craftRecipe("stick", 1)',
        !facts.nearbyFoodMob || facts.hasMeleeWeapon || facts.sticks >= 1 ? 'done' : (facts.planks >= 2 ? 'pending' : 'blocked'),
        'Need 2 planks before making weapon sticks.'
    ));

    const huntingWeaponCommand = facts.cobblestone >= 2 ? '!craftRecipe("stone_sword", 1)' : '!craftRecipe("wooden_sword", 1)';
    const canCraftHuntingWeapon = facts.sticks >= 1 && (facts.cobblestone >= 2 || facts.planks >= 2);
    tasks.push(makeTask(
        'make_hunting_weapon',
        'Craft a basic sword before hunting if resources are already available.',
        huntingWeaponCommand,
        !facts.nearbyFoodMob || facts.hasMeleeWeapon ? 'done' : (canCraftHuntingWeapon ? 'pending' : 'blocked'),
        'Need a stick plus stone or planks for a quick hunting weapon.'
    ));

    tasks.push(makeTask(
        'attack_food_mob',
        'Kill the nearby food animal.',
        facts.nearbyFoodMob ? `!attack("${facts.nearbyFoodMob}")` : '!entities',
        facts.nearbyFoodMob ? 'pending' : 'done'
    ));

    tasks.push(makeTask(
        'find_food_mob',
        'Search for one food animal type, then attack it before switching goals.',
        selectFoodSearchCommand(agent),
        facts.foodSecure ? 'done' : 'pending'
    ));

    return {
        objective_id: facts.hunger <= 12 ? 'urgent_food' : 'secure_food',
        objective: facts.hunger <= 12 ? 'Get edible food now.' : 'Secure a small food buffer.',
        reason: 'Food is the active bottleneck; mining and extra torches wait until food is handled.',
        microtasks: withActive(tasks)
    };
}

function buildImmediateSafetyPlan(agent, facts) {
    const hasHostileNearby = facts.nearbyHostiles && facts.nearbyHostiles.length > 0;
    const retreatedRecently = didRecently(agent, '!moveaway', 6);
    const shouldRetreat = (hasHostileNearby || facts.recentlyDamaged) && !retreatedRecently;
    return {
        objective_id: 'immediate_safety',
        objective: 'Survive the immediate danger.',
        reason: 'Health is low and the bot cannot safely continue normal work yet.',
        microtasks: withActive([
            makeTask(
                'retreat',
                hasHostileNearby ? `Retreat from nearby hostile mob(s): ${facts.nearbyHostiles.join(', ')}.` : 'Retreat to a safer area before continuing.',
                '!moveAway(24)',
                shouldRetreat ? 'pending' : 'done'
            ),
            makeTask('inspect_after_retreat', 'Inspect nearby entities after retreating.', '!entities', 'pending')
        ])
    };
}

function buildEquipmentPlan(facts) {
    return {
        objective_id: 'equip_gear',
        objective: 'Equip available protective gear.',
        reason: 'Armor or better combat gear is in inventory but not being worn or held.',
        microtasks: withActive([
            makeTask('equip_best_gear', 'Equip the best available armor and practical weapon.', '!equipBestGear', 'pending'),
            makeTask('verify_inventory', 'Verify worn armor and held item.', '!inventory', 'pending')
        ])
    };
}

function buildLightPlan(facts) {
    const tasks = [
        makeTask('craft_torches', 'Craft one torch batch, not a torch loop.', '!craftRecipe("torch", 1)', facts.torches >= 12 || (!facts.coal && !facts.charcoal) || facts.sticks < 1 ? 'done' : 'pending'),
        makeTask('make_sticks', 'Make sticks for torches only if there is coal and too few sticks.', '!craftRecipe("stick", 1)', facts.torches >= 12 || facts.sticks > 0 || (!facts.coal && !facts.charcoal) ? 'done' : 'pending'),
        makeTask('mine_coal', 'Mine a small coal batch for torches instead of only walking to it.', '!collectBlocks("coal_ore", 4)', facts.torches >= 12 || facts.coal > 0 || facts.charcoal > 0 ? 'done' : 'pending')
    ];

    return {
        objective_id: 'light_source',
        objective: 'Create a modest light buffer.',
        reason: 'Torches improve safety, but only until the buffer is enough.',
        microtasks: withActive(tasks)
    };
}

function buildShelterPlan(agent, facts) {
    const bedType = BEDS.find(b => facts.inventory[b] > 0) || 'white_bed';
    const plankRecipe = getPlankRecipeFromInventory(facts.inventory);
    const woodPotential = facts.planks + (facts.logs * 4);
    const woodCommand = selectWoodCommand(agent, facts, 3);
    return {
        objective_id: 'establish_shelter',
        objective: 'Establish a survival base with workstations and storage.',
        reason: 'A base gives the bot a safe anchor with crafting, smelting, light, and storage.',
        microtasks: withActive([
            makeTask('remember_base', 'Remember the current safe working spot as base.', '!rememberHere("base")', facts.hasBase ? 'done' : 'pending'),
            makeTask('place_torch', 'Place one torch at the base if available.', '!placeHere("torch")', facts.torchPlaced ? 'done' : (facts.torches > 0 ? 'pending' : 'blocked'), facts.torches <= 0 ? 'Need torches first.' : ''),
            makeTask('collect_storage_wood', 'Collect a small wood buffer for base storage and stations.', woodCommand, woodPotential >= 12 || facts.hasChest ? 'done' : 'pending'),
            makeTask('make_storage_planks', 'Convert logs to planks for chest and workstations.', `!craftRecipe("${plankRecipe}", 1)`, facts.planks >= 8 || facts.logs <= 0 || facts.hasChest ? 'done' : 'pending'),
            makeTask('craft_chest', 'Craft a chest for storage.', '!craftRecipe("chest", 1)', facts.hasChest ? 'done' : (facts.planks >= 8 ? 'pending' : 'blocked'), 'Need 8 planks.'),
            makeTask('place_chest', 'Place the chest at base.', '!placeHere("chest")', facts.chestPlaced ? 'done' : (facts.hasBase && facts.inventory.chest > 0 ? 'pending' : 'blocked')),
            makeTask('craft_table', 'Have a crafting table for the base.', '!craftRecipe("crafting_table", 1)', facts.hasCraftingTable ? 'done' : (facts.planks >= 4 ? 'pending' : 'blocked'), 'Need 4 planks.'),
            makeTask('place_table', 'Place crafting table at the base if it is only in inventory.', '!placeHere("crafting_table")', facts.craftingTablePlaced ? 'done' : (facts.hasBase && facts.inventory.crafting_table > 0 ? 'pending' : 'blocked')),
            makeTask('collect_furnace_stone', 'Collect cobblestone for a furnace.', '!collectBlocks("stone", 8)', facts.hasFurnace || facts.cobblestone >= 8 ? 'done' : 'pending'),
            makeTask('craft_furnace', 'Craft a furnace for cooking and smelting.', '!craftRecipe("furnace", 1)', facts.hasFurnace ? 'done' : (facts.cobblestone >= 8 ? 'pending' : 'blocked'), 'Need 8 cobblestone.'),
            makeTask('place_furnace', 'Place furnace at the base.', '!placeHere("furnace")', facts.furnacePlaced ? 'done' : (facts.hasBase && facts.inventory.furnace > 0 ? 'pending' : 'blocked')),
            makeTask('get_wool_for_bed', 'Get wool from sheep only when a bed is still missing.', '!searchForEntity("sheep", 64)', facts.hasBed || facts.wool >= 3 ? 'done' : 'pending'),
            makeTask('craft_bed', 'Craft a bed for respawn.', `!craftRecipe("${bedType}", 1)`, facts.hasBed ? 'done' : (facts.wool >= 3 && facts.planks >= 3 ? 'pending' : 'blocked'), 'Need 3 wool and 3 planks.'),
            makeTask('place_bed', 'Place the bed and sleep to set spawn.', `!placeHere("${bedType}")`, facts.hasBase && facts.hasBed ? 'pending' : 'blocked')
        ])
    };
}

function buildFarmPlan(facts) {
    const hoeRecipe = facts.cobblestone >= 2 ? 'stone_hoe' : 'wooden_hoe';
    const hoeName = firstItemInInventory(facts.inventory, HOES) || hoeRecipe;
    const seedName = firstItemInInventory(facts.inventory, SEEDS) || 'wheat_seeds';

    return {
        objective_id: 'starter_farm',
        objective: 'Start a small renewable food farm.',
        reason: 'A base should eventually produce food instead of relying only on hunting.',
        microtasks: withActive([
            makeTask('craft_hoe', 'Craft a hoe for tilling farmland.', `!craftRecipe("${hoeRecipe}", 1)`, facts.highestHoeTier >= toolTier('wooden_hoe') ? 'done' : (facts.sticks >= 2 && (facts.cobblestone >= 2 || facts.planks >= 2) ? 'pending' : 'blocked'), 'Need 2 sticks plus stone or planks.'),
            makeTask('collect_seeds', 'Collect seeds from grass if none are available.', '!collectBlocks("short_grass", 8)', facts.seeds > 0 ? 'done' : 'pending'),
            makeTask('till_dirt', 'Till nearby grass into farmland.', `!useOn("${hoeName}", "grass_block")`, facts.hasFarm ? 'done' : (facts.highestHoeTier >= 0 ? 'pending' : 'blocked')),
            makeTask('plant_seed', 'Plant the first seed in nearby farmland.', `!useOn("${seedName}", "farmland")`, facts.hasFarm && facts.seeds > 0 ? 'pending' : 'blocked')
        ])
    };
}

function buildTradePlan(facts) {
    return {
        objective_id: 'opportunistic_trade',
        objective: 'Use a nearby villager for one safe useful trade.',
        reason: 'A villager is nearby and the inventory has likely trade goods or emeralds.',
        microtasks: withActive([
            makeTask('confirm_villager', 'Confirm the adult villager is nearby and get its id.', '!entities', facts.nearbyVillagerId ? 'done' : 'pending'),
            makeTask(
                'auto_trade',
                `Execute one safe affordable trade with villager ${facts.nearbyVillagerId} (${facts.nearbyVillagerProfession || 'unknown profession'}).`,
                facts.nearbyVillagerId ? `!autoTradeWithVillager(${facts.nearbyVillagerId}, "any", 1)` : '!entities',
                facts.nearbyVillagerId && facts.tradeReady ? 'pending' : 'blocked',
                facts.tradeReady ? '' : 'Need emeralds or safe surplus trade goods before trading.'
            )
        ])
    };
}

function buildIronPlan(agent, facts) {
    const woodCommand = selectWoodCommand(agent, facts, 2);
    const plankRecipe = getPlankRecipeFromInventory(facts.inventory);
    const ironCommand = failedRecently(agent, '!collectBlocks:iron_ore')
        ? '!searchForBlock("iron_ore", 96)'
        : '!collectBlocks("iron_ore", 3)';

    const tasks = [
        makeTask('get_stick_wood', 'Collect a tiny wood buffer for sticks if none is available.', woodCommand, facts.sticks >= 2 || facts.planks > 0 || facts.logs > 0 ? 'done' : 'pending'),
        makeTask('make_planks', 'Convert wood into planks for sticks if needed.', `!craftRecipe("${plankRecipe}", 1)`, facts.planks >= 2 ? 'done' : (facts.logs > 0 ? 'pending' : 'blocked'), 'Need logs before making planks.'),
        makeTask('make_sticks', 'Make sticks for the iron pickaxe only if needed.', '!craftRecipe("stick", 1)', facts.sticks >= 2 ? 'done' : 'pending'),
        makeTask('get_furnace_stone', 'Collect cobblestone for a furnace if none is available.', '!collectBlocks("stone", 8)', facts.hasFurnace || facts.cobblestone >= 8 ? 'done' : 'pending'),
        makeTask('furnace_for_iron', 'Craft a furnace for iron processing.', '!craftRecipe("furnace", 1)', facts.hasFurnace ? 'done' : (facts.cobblestone >= 8 ? 'pending' : 'blocked'), 'Need 8 cobblestone.'),
        makeTask('get_fuel', 'Get a small fuel buffer for smelting.', facts.coal > 0 || facts.charcoal > 0 ? '!inventory' : woodCommand, facts.hasFuel ? 'done' : 'pending'),
        makeTask('smelt_iron', 'Smelt raw iron into ingots.', `!smeltItem("raw_iron", ${Math.min(3, facts.rawIron)})`, facts.rawIron > 0 && facts.hasFurnace && facts.hasFuel ? 'pending' : 'done'),
        makeTask('mine_iron', 'Mine or locate iron ore safely.', ironCommand, facts.rawIron > 0 || facts.ironIngot >= 3 ? 'done' : 'pending'),
        makeTask(
            'craft_iron_pickaxe',
            'Craft iron pickaxe only with enough ingots and sticks.',
            '!craftRecipe("iron_pickaxe", 1)',
            facts.highestPickaxeTier >= toolTier('iron_pickaxe') ? 'done' : (facts.ironIngot >= 3 && facts.sticks >= 2 ? 'pending' : 'blocked'),
            'Need 3 iron_ingot and 2 sticks.'
        ),
        makeTask('iron_axe', 'Craft an iron axe if spare ingots exist, otherwise keep the stone axe.', '!craftRecipe("iron_axe", 1)', facts.highestAxeTier >= toolTier('iron_axe') || facts.ironIngot < 3 ? 'done' : (facts.sticks >= 2 ? 'pending' : 'blocked'), 'Need 3 iron ingots and 2 sticks.'),
        makeTask('iron_armor', 'Craft at least one piece of iron armor for safety.', '!craftRecipe("iron_chestplate", 1)', facts.armorCount > 0 ? 'done' : (facts.ironIngot >= 8 ? 'pending' : 'blocked'), 'Need 8 iron ingots for a chestplate.'),
        makeTask('equip_armor', 'Equip armor immediately after crafting or finding it.', '!equipBestGear', facts.hasUnequippedArmor ? 'pending' : 'done')
    ];

    return {
        objective_id: 'iron_progression',
        objective: 'Progress toward iron safely.',
        reason: 'Iron is the next sane tool tier after stone, food, light, and a base anchor.',
        microtasks: withActive(tasks)
    };
}

function buildDiamondPlan(agent, facts) {
    const woodCommand = selectWoodCommand(agent, facts, 2);
    const diamondCommand = failedRecently(agent, '!collectBlocks:diamond_ore')
        ? '!searchForBlock("diamond_ore", 96)'
        : '!collectBlocks("diamond_ore", 3)';

    const tasks = [
        makeTask('get_diamond_wood', 'Gather wood for sticks if needed.', woodCommand, facts.sticks >= 2 ? 'done' : 'pending'),
        makeTask('make_diamond_sticks', 'Make sticks for diamond pickaxe if needed.', '!craftRecipe("stick", 1)', facts.sticks >= 2 ? 'done' : 'pending'),
        makeTask('mine_diamond', 'Mine diamond ore safely with iron pickaxe.', diamondCommand, facts.diamond >= 3 ? 'done' : 'pending'),
        makeTask(
            'craft_diamond_pickaxe',
            'Craft diamond pickaxe with diamonds and sticks.',
            '!craftRecipe("diamond_pickaxe", 1)',
            facts.highestPickaxeTier >= toolTier('diamond_pickaxe') ? 'done' : (facts.diamond >= 3 && facts.sticks >= 2 ? 'pending' : 'blocked'),
            'Need 3 diamond and 2 sticks.'
        )
    ];

    return {
        objective_id: 'diamond_progression',
        objective: 'Progress toward diamond tools.',
        reason: 'Diamond is the next tier after iron for advanced mining and exploration.',
        microtasks: withActive(tasks)
    };
}

function buildExplorationPlan(agent, facts) {
    const curiosityTask = agent.curiosity_evaluator?.suggestExplorationMicrotask?.(facts);
    return {
        objective_id: 'exploration_and_building',
        objective: 'Explore and build advanced structures.',
        reason: 'With advanced tools ready, focus on exploration and construction.',
        microtasks: withActive([
            curiosityTask || makeTask('explore', 'Explore the world and find rare structures.', '!moveAway(200)', 'pending'),
            makeTask('gather_advanced', 'Gather varied resources for building.', '!collectBlocks("oak_log", 10)', 'pending'),
            makeTask('inventory_check', 'Check inventory status.', '!stats', 'pending')
        ])
    };
}

function buildInventoryPlan(agent, facts, inventoryTask) {
    return {
        objective_id: 'inventory_management',
        objective: 'Manage inventory pressure intelligently.',
        reason: 'A full inventory blocks collection, wastes resources, and causes repeated action failures.',
        microtasks: withActive([
            inventoryTask,
            makeTask('inspect_inventory', 'Inspect inventory after management.', '!inventory', 'pending')
        ])
    };
}

function buildCuriosityPlan(agent, facts) {
    const curiosityTask = agent.curiosity_evaluator?.suggestExplorationMicrotask?.(facts) ||
        makeTask('curiosity_explore', 'Explore a nearby novel region safely.', '!moveAway(96)', 'pending');
    return {
        objective_id: 'curiosity_exploration',
        objective: 'Explore a novel nearby area while survival is stable.',
        reason: 'Curiosity pressure is high and current survival prerequisites are secure enough for a bounded exploration step.',
        microtasks: withActive([
            curiosityTask,
            makeTask('inspect_new_area', 'Inspect the new area after moving.', '!nearbyBlocks', 'pending'),
            makeTask('check_entities', 'Check entities and social opportunities in the new area.', '!entities', 'pending')
        ])
    };
}

export function buildObjectivePlan(agent) {
    const facts = getFacts(agent);
    agent.task_manager?.syncProgress?.(facts);
    const inventoryTask = agent.inventory_manager?.getManagementTask?.(facts) || null;
    
    let plan;

    if (facts.health <= 10 && facts.readyFoodItem) {
        plan = {
            objective_id: 'recover_health',
            objective: 'Recover health by eating.',
            reason: 'Health is low and food is available.',
            microtasks: withActive([
                makeTask('eat_now', 'Eat before doing anything else.', `!consume("${facts.readyFoodItem}")`, 'pending')
            ])
        };
    } else if (facts.health <= 8 && (facts.nearbyHostiles.length > 0 || facts.recentlyDamaged)) {
        plan = buildImmediateSafetyPlan(agent, facts);
    } else if (facts.hasUnequippedArmor) {
        plan = buildEquipmentPlan(facts);
    } else if (facts.hunger <= 8 && facts.readyFood === 0) {
        plan = buildFoodPlan(agent, facts);
    } else if (inventoryTask && facts.health > 10 && facts.hunger > 8) {
        plan = buildInventoryPlan(agent, facts, inventoryTask);
    } else if (facts.highestPickaxeTier < toolTier('wooden_pickaxe') && facts.hunger > 8) {
        plan = buildWoodenPickaxePlan(agent, facts);
    } else if (facts.hunger <= 12 || (facts.hunger <= 16 && facts.readyFood === 0)) {
        plan = buildFoodPlan(agent, facts);
    } else if (facts.highestPickaxeTier < toolTier('wooden_pickaxe')) {
        plan = buildWoodenPickaxePlan(agent, facts);
    } else if (facts.highestPickaxeTier < toolTier('stone_pickaxe') || facts.highestAxeTier < toolTier('stone_axe')) {
        plan = buildStonePickaxePlan(agent, facts);
    } else if (!facts.foodSecure || facts.hunger <= 14) {
        plan = buildFoodPlan(agent, facts);
    } else if (facts.torches < 8) {
        plan = buildLightPlan(facts);
    } else if (!facts.hasBase || !facts.chestPlaced || !facts.craftingTablePlaced || !facts.furnacePlaced) {
        plan = buildShelterPlan(agent, facts);
    } else if (!facts.hasFarm && facts.hasBase) {
        plan = buildFarmPlan(facts);
    } else if (facts.nearbyVillagerId && facts.tradeReady &&
        !failedRecently(agent, `!autoTradeWithVillager:${facts.nearbyVillagerId}`) &&
        !tradedRecently(agent, facts.nearbyVillagerId)) {
        plan = buildTradePlan(facts);
    } else if (agent.curiosity_evaluator?.shouldInterleaveExploration?.(facts)) {
        plan = buildCuriosityPlan(agent, facts);
    } else if (facts.highestPickaxeTier < toolTier('iron_pickaxe')) {
        plan = buildIronPlan(agent, facts);
    } else if (facts.highestPickaxeTier < toolTier('diamond_pickaxe')) {
        plan = buildDiamondPlan(agent, facts);
    } else {
        plan = buildExplorationPlan(agent, facts);
    }

    let activeTask = plan.microtasks.find(task => task.status === 'active') ||
        plan.microtasks.find(task => task.status === 'pending');
    if (activeTask && activeTask.status === 'pending') activeTask.status = 'active';
    if (!activeTask) {
        const blockedTask = plan.microtasks.find(task => task.status === 'blocked');
        if (blockedTask) {
            activeTask = {
                ...blockedTask,
                id: `${blockedTask.id}_inspect`,
                text: `Inspect prerequisites for blocked task: ${blockedTask.text}`,
                command: '!inventory',
                status: 'active'
            };
            plan.microtasks.unshift(activeTask);
        }
    }

    return {
        ...plan,
        active_task: activeTask || null,
        facts: {
            health: facts.health,
            hunger: facts.hunger,
            recentlyDamaged: facts.recentlyDamaged,
            planks: facts.planks,
            logs: facts.logs,
            sticks: facts.sticks,
            cobblestone: facts.cobblestone,
            torches: facts.torches,
            coal: facts.coal,
            rawIron: facts.rawIron,
            ironIngot: facts.ironIngot,
            readyFood: facts.readyFood,
            rawFood: facts.rawFood,
            highestPickaxeTier: facts.highestPickaxeTier,
            highestAxeTier: facts.highestAxeTier,
            highestHoeTier: facts.highestHoeTier,
            hasMeleeWeapon: facts.hasMeleeWeapon,
            hasFurnace: facts.hasFurnace,
            hasFuel: facts.hasFuel,
            hasCraftingTable: facts.hasCraftingTable,
            chestPlaced: facts.chestPlaced,
            furnacePlaced: facts.furnacePlaced,
            craftingTablePlaced: facts.craftingTablePlaced,
            armorCount: facts.armorCount,
            equippedArmorCount: facts.equippedArmorCount,
            hasUnequippedArmor: facts.hasUnequippedArmor,
            hasFarm: facts.hasFarm,
            seeds: facts.seeds,
            wool: facts.wool,
            diamond: facts.diamond,
            preferredWoodTarget: facts.preferredWoodTarget,
            nearbyWood: facts.nearbyWood,
            nearbyHostiles: facts.nearbyHostiles,
            preferredFoodMob: facts.preferredFoodMob,
            nearbyVillagerId: facts.nearbyVillagerId,
            nearbyVillagerProfession: facts.nearbyVillagerProfession,
            emerald: facts.emerald,
            tradeGoods: facts.tradeGoods,
            hasBase: facts.hasBase
        }
    };
}

export function formatObjectivePlan(agent) {
    const plan = buildObjectivePlan(agent);
    const lines = [
        `Main objective: ${plan.objective}`,
        `Why this objective: ${plan.reason}`,
        `Active microtask: ${plan.active_task?.text || 'none'}`,
        `Suggested command: ${plan.active_task?.command || '!stats'}`,
        `State facts: ${JSON.stringify(plan.facts)}`,
        'Microtask queue:'
    ];

    for (const task of plan.microtasks) {
        const marker = task.status === 'done' ? '[done]' : task.status === 'active' ? '[now]' : task.status === 'blocked' ? '[blocked]' : '[next]';
        const reason = task.reason ? ` (${task.reason})` : '';
        lines.push(`- ${marker} ${task.text} -> ${task.command}${reason}`);
    }

    lines.push('Planner contract: finish the [now] microtask unless there is immediate danger or the command is blocked. If it fails, choose a fallback inside the same objective instead of jumping to a new project.');
    return lines.join('\n');
}

export function getSurvivalMilestone(agent) {
    const plan = buildObjectivePlan(agent);
    return `Current objective: ${plan.objective} Active microtask: ${plan.active_task?.text || 'none'} Suggested command: ${plan.active_task?.command || '!stats'}`;
}

function isFoodObjective(plan) {
    return plan.objective_id === 'urgent_food' || plan.objective_id === 'secure_food';
}

function isWoodObjective(plan) {
    return plan.objective_id === 'wooden_pickaxe';
}

function isStoneObjective(plan) {
    return plan.objective_id === 'stone_pickaxe';
}

function isTradeObjective(plan) {
    return plan.objective_id === 'opportunistic_trade';
}

function isInventoryObjective(plan) {
    return plan.objective_id === 'inventory_management';
}

function isCuriosityObjective(plan) {
    return plan.objective_id === 'curiosity_exploration' || plan.objective_id === 'exploration_and_building';
}

function commandTargetsFoodMob(commandName, args) {
    return ['!searchForEntity', '!attack'].includes(commandName) && FOOD_MOBS.includes(args[0]);
}

function commandTargetsRawFood(commandName, args) {
    return commandName === '!smeltItem' && RAW_FOOD.includes(args[0]);
}

function commandTargetsRelevantCraft(commandName, args, allowedItems) {
    return commandName === '!craftRecipe' && allowedItems.includes(args[0]);
}

function commandArgsMatch(actualArgs, expectedArgs) {
    if (actualArgs.length !== expectedArgs.length) return false;
    return actualArgs.every((arg, index) => String(arg) === String(expectedArgs[index]));
}

function commandMatchesExpected(message, commandName, expectedCommand) {
    const expected = parseCommandMessage(expectedCommand || '');
    if (typeof expected === 'string') return false;
    const actual = parseCommandMessage(message);
    if (typeof actual === 'string') return false;
    return commandName === expected.commandName && commandArgsMatch(actual.args, expected.args);
}

function suggestedCommandFailed(agent, suggestion) {
    const expected = parseCommandMessage(suggestion || '');
    if (typeof expected === 'string') return false;
    const key = agent?.memory_prompter?.getActionKey?.(suggestion, expected.commandName);
    return key ? agent?.memory_bank?.shouldAbortAction?.(key) : false;
}

export function evaluateObjectiveAlignment(agent, message, commandName) {
    const parsed = parseCommandMessage(message);
    if (typeof parsed === 'string') return null;

    const plan = buildObjectivePlan(agent);
    const [target, quantity] = parsed.args;
    const facts = plan.facts;
    if (!facts) return null;
    const suggestion = plan.active_task?.command || '!stats';

    if (SAFE_QUERY_COMMANDS.has(commandName)) return null;

    if (plan.active_task?.status === 'active' &&
        suggestion &&
        !commandMatchesExpected(message, commandName, suggestion) &&
        !suggestedCommandFailed(agent, suggestion)) {
        return {
            blocked: true,
            reason: `The active microtask is "${plan.active_task.text}". The command must follow that microtask instead of skipping ahead.`,
            suggestion
        };
    }

    if (facts.health <= 10 && commandName !== '!consume' && facts.readyFood > 0) {
        return {
            blocked: true,
            reason: 'Health is low and edible food is available; survival overrides every other plan.',
            suggestion
        };
    }

    if (isFoodObjective(plan)) {
        const allowedFoodWork =
            commandName === '!consume' ||
            commandName === '!moveAway' ||
            commandTargetsFoodMob(commandName, parsed.args) ||
            commandTargetsRawFood(commandName, parsed.args) ||
            commandTargetsRelevantCraft(commandName, parsed.args, ['furnace', 'stick', 'wooden_sword', 'stone_sword']) ||
            (commandName === '!collectBlocks' && target === 'stone' && facts.rawFood > 0 && !facts.hasFurnace && facts.cobblestone < 8 && facts.highestPickaxeTier >= toolTier('wooden_pickaxe')) ||
            (['!collectBlocks', '!searchForBlock'].includes(commandName) && isWoodBlock(target) && facts.rawFood > 0 && !facts.hasFuel) ||
            (commandName === '!searchForBlock' && target === 'coal_ore' && facts.rawFood > 0 && !facts.hasFuel && facts.coal === 0);

        if (!allowedFoodWork) {
            return {
                blocked: true,
                reason: `The active objective is food, but ${commandName}${target ? `(${target})` : ''} does not advance that objective.`,
                suggestion
            };
        }
    }

    if (isWoodObjective(plan)) {
        const allowedWoodWork =
            (['!collectBlocks', '!searchForBlock'].includes(commandName) && isWoodBlock(target)) ||
            (commandName === '!placeHere' && target === 'crafting_table') ||
            (commandName === '!moveAway' && plan.active_task?.id === 'place_table') ||
            commandTargetsRelevantCraft(commandName, parsed.args, ['oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks', 'crimson_planks', 'warped_planks', 'stick', 'crafting_table', 'wooden_pickaxe', 'wooden_axe']);

        if (!allowedWoodWork) {
            return {
                blocked: true,
                reason: `The active objective is the first wooden pickaxe; ${commandName}${target ? `(${target})` : ''} is a detour.`,
                suggestion
            };
        }
    }

    if (isStoneObjective(plan)) {
        const allowedStoneWork =
            (commandName === '!collectBlocks' && target === 'stone') ||
            commandTargetsRelevantCraft(commandName, parsed.args, ['stick', 'stone_pickaxe', 'stone_axe']);

        if (!allowedStoneWork) {
            return {
                blocked: true,
                reason: `The active objective is stone pickaxe; finish that before switching projects.`,
                suggestion
            };
        }
    }

    if (isTradeObjective(plan)) {
        const allowedTradeWork = ['!entities', '!showVillagerTrades', '!tradeWithVillager', '!autoTradeWithVillager'].includes(commandName);

        if (!allowedTradeWork) {
            return {
                blocked: true,
                reason: `The active objective is villager trading; ${commandName}${target ? `(${target})` : ''} does not advance that trade.`,
                suggestion
            };
        }
    }

    if (isInventoryObjective(plan)) {
        const allowedInventoryWork = ['!inventory', '!viewChest', '!putInChest', '!takeFromChest', '!placeHere', '!craftRecipe', '!discard'].includes(commandName);

        if (!allowedInventoryWork) {
            return {
                blocked: true,
                reason: `The active objective is inventory management; ${commandName}${target ? `(${target})` : ''} does not relieve inventory pressure.`,
                suggestion
            };
        }
    }

    if (isCuriosityObjective(plan)) {
        const allowedCuriosityWork = ['!moveAway', '!nearbyBlocks', '!entities', '!stats', '!rememberHere', '!searchForBlock', '!searchForEntity', '!goToRememberedPlace'].includes(commandName);

        if (!allowedCuriosityWork) {
            return {
                blocked: true,
                reason: `The active objective is bounded exploration; ${commandName}${target ? `(${target})` : ''} is not an exploration or inspection step.`,
                suggestion
            };
        }
    }

    if (commandName === '!craftRecipe' && target === 'torch' && facts.torches >= 16) {
        return {
            blocked: true,
            reason: `You already have ${facts.torches} torches. More torches are a loop, not progress.`,
            suggestion
        };
    }

    if (commandName === '!collectBlocks' && target === 'coal_ore' && facts.torches >= 16 && !['light_source', 'iron_progression'].includes(plan.objective_id)) {
        return {
            blocked: true,
            reason: `Coal is not the current bottleneck and ${facts.torches} torches is already enough.`,
            suggestion
        };
    }

    if (commandName === '!smeltItem' && target === 'coal_ore') {
        return {
            blocked: true,
            reason: 'coal_ore is not a useful smelting input.',
            suggestion
        };
    }

    if (commandName === '!craftRecipe' && Number(quantity) > 1 && ['stick', 'torch', 'crafting_table'].includes(target)) {
        return {
            blocked: true,
            reason: `Bulk crafting ${target} makes the bot overshoot. Use one recipe at a time for utility items.`,
            suggestion
        };
    }

    return null;
}

export class ObjectivePlanner {
    constructor(agent) {
        this.agent = agent;
        this.stateFile = path.join(agent.memory_bank.memoryDir, 'active_plan.json');
        this.state = this.loadState();
        if (agent.bot?.inventory) {
            this.saveSnapshot();
        }
    }

    loadState() {
        try {
            if (fs.existsSync(this.stateFile)) {
                return JSON.parse(fs.readFileSync(this.stateFile, 'utf-8'));
            }
        } catch (err) {
            console.error(`Error loading objective planner state from ${this.stateFile}:`, err);
        }
        return {
            current_objective_id: null,
            current_objective_started_at: null,
            last_suggested_command: null,
            updated_at: null
        };
    }

    saveState() {
        try {
            fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
        } catch (err) {
            console.error(`Error saving objective planner state to ${this.stateFile}:`, err);
        }
    }

    getPlan() {
        const plan = buildObjectivePlan(this.agent);
        if (this.state.current_objective_id !== plan.objective_id) {
            this.state.current_objective_id = plan.objective_id;
            this.state.current_objective_started_at = new Date().toISOString();
            this.agent.memory_bank.addEvent(`Objective changed: ${plan.objective}`);
            if (plan.objective_id === 'curiosity_exploration') {
                this.agent.curiosity_evaluator?.markExplorationChosen?.();
            }
        }
        this.state.last_suggested_command = plan.active_task?.command || null;
        this.state.updated_at = new Date().toISOString();
        this.saveState();
        return plan;
    }

    formatPrompt() {
        const text = formatObjectivePlan(this.agent);
        this.getPlan();
        return text;
    }

    evaluateCommand(message, commandName) {
        return evaluateObjectiveAlignment(this.agent, message, commandName);
    }

    recordActionResult(commandText, commandName, result) {
        const resultText = String(result || '').toLowerCase();
        if (commandName === '!moveAway' && /(moved|success|arrived|reached|completed)/.test(resultText)) {
            for (const mob of FOOD_MOBS) {
                this.agent.memory_bank.resetFailedAttempt(`!searchForEntity:${mob}`);
            }
            this.agent.memory_bank.addEvent('Food search area changed; animal search failures were reset.');
            for (const block of WOOD_BLOCKS) {
                this.agent.memory_bank.resetFailedAttempt(`!collectBlocks:${block}`);
                this.agent.memory_bank.resetFailedAttempt(`!searchForBlock:${block}`);
            }
            this.agent.memory_bank.addEvent('Wood search area changed; wood collection failures were reset.');
            this.agent.memory_bank.resetFailedAttempt('!placeHere');
            this.agent.memory_bank.resetFailedAttempt('!placeHere:crafting_table');
            this.agent.memory_bank.addEvent('Placement area changed; crafting table placement failures were reset.');
        }
        if (commandName === '!searchForBlock' && /(found .* at \(|you have reached|arrived|reached)/.test(resultText)) {
            const parsed = parseCommandMessage(commandText);
            if (typeof parsed !== 'string') {
                const [target] = parsed.args;
                this.agent.memory_bank.resetFailedAttempt(`!collectBlocks:${target}`);
                this.agent.memory_bank.addEvent(`Block search reached ${target}; next step should collect it instead of searching again.`);
            }
        }
        this.saveSnapshot(commandText, commandName, result);
    }

    saveSnapshot(commandText = null, commandName = null, result = null) {
        const plan = buildObjectivePlan(this.agent);
        this.state.current_objective_id = plan.objective_id;
        this.state.last_suggested_command = plan.active_task?.command || null;
        this.state.snapshot = {
            objective: plan.objective,
            objective_id: plan.objective_id,
            active_microtask: plan.active_task?.text || null,
            suggested_command: plan.active_task?.command || null,
            facts: plan.facts,
            last_command: commandText,
            last_command_name: commandName,
            last_result: result ? String(result).slice(0, 500) : null
        };
        this.state.updated_at = new Date().toISOString();
        this.saveState();
    }
}
