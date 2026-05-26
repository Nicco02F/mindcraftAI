import { parseCommandMessage } from './commands/index.js';
import * as world from './library/world.js';
import * as mc from '../utils/mcdata.js';
import settings from './settings.js';
import { evaluateObjectiveAlignment, getSurvivalMilestone as getPlannedSurvivalMilestone } from './objective_planner.js';
import { isWoodBlock } from './world_model.js';

const WOOD_TYPES = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'crimson', 'warped'];
const PICKAXES = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'];
const AXES = ['wooden_axe', 'stone_axe', 'iron_axe', 'diamond_axe', 'netherite_axe'];
const SHOVELS = ['wooden_shovel', 'stone_shovel', 'iron_shovel', 'diamond_shovel', 'netherite_shovel'];
const SWORDS = ['wooden_sword', 'stone_sword', 'iron_sword', 'diamond_sword', 'netherite_sword'];
const HOES = ['wooden_hoe', 'stone_hoe', 'iron_hoe', 'diamond_hoe', 'netherite_hoe'];
const TOOL_TIERS = ['wooden', 'stone', 'iron', 'diamond', 'netherite'];
const PICKAXE_BLOCK_TARGETS = new Set([
    'stone',
    'cobblestone',
    'coal_ore',
    'deepslate_coal_ore',
    'iron_ore',
    'deepslate_iron_ore',
    'copper_ore',
    'deepslate_copper_ore',
    'gold_ore',
    'deepslate_gold_ore',
    'redstone_ore',
    'deepslate_redstone_ore',
    'lapis_ore',
    'deepslate_lapis_ore',
    'diamond_ore',
    'deepslate_diamond_ore'
]);

function countItems(inventory, predicate) {
    return Object.entries(inventory)
        .filter(([name]) => predicate(name))
        .reduce((total, [, count]) => total + count, 0);
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

function firstMissingToolPrerequisite(item, inventory) {
    const planks = countPlanks(inventory);
    const sticks = inventory.stick || 0;
    const logs = countLogs(inventory);

    if (item === 'wooden_pickaxe') {
        if (planks < 3) {
            if (logs > 0) return `craft more planks first with !craftRecipe("${getPlankRecipeFromInventory(inventory)}", 1)`;
            return 'collect any available usable wood first. Use the active objective planner preferred_wood target, or inspect with !nearbyBlocks.';
        }
        if (sticks < 2) return 'craft sticks first with !craftRecipe("stick", 1)';
    }

    if (item === 'stone_pickaxe') {
        if ((inventory.cobblestone || 0) < 3) return 'collect stone/cobblestone first with !collectBlocks("stone", 3)';
        if (sticks < 2) return 'craft sticks first with !craftRecipe("stick", 1)';
    }

    if (item === 'iron_pickaxe') {
        if ((inventory.iron_ingot || 0) < 3) return 'mine raw_iron, smelt it into iron_ingot, then craft the iron pickaxe';
        if (sticks < 2) return 'craft sticks first with !craftRecipe("stick", 1)';
    }

    if (item === 'diamond_pickaxe') {
        if (!inventory.iron_pickaxe && !inventory.diamond_pickaxe && !inventory.netherite_pickaxe) {
            return 'do not target diamond tools yet; craft an iron_pickaxe and secure food/shelter first';
        }
        if ((inventory.diamond || 0) < 3) return 'diamonds are not available yet; explore safely for iron, coal, food, and shelter first';
        if (sticks < 2) return 'craft sticks first with !craftRecipe("stick", 1)';
    }

    if (['wooden_axe', 'wooden_shovel', 'wooden_sword', 'wooden_hoe'].includes(item)) {
        const requiredPlanks = item === 'wooden_shovel' ? 1 : 2;
        if (planks < requiredPlanks) {
            if (logs > 0) return `craft planks first with !craftRecipe("${getPlankRecipeFromInventory(inventory)}", 1)`;
            return 'collect logs first instead of retrying this craft';
        }
        if (sticks < (item === 'wooden_sword' ? 1 : 2)) return 'craft sticks first with !craftRecipe("stick", 1)';
    }

    if (item === 'stone_axe' || item === 'stone_hoe') {
        const neededCobble = item === 'stone_axe' ? 3 : 2;
        if ((inventory.cobblestone || 0) < neededCobble) return `collect stone/cobblestone first with !collectBlocks("stone", ${neededCobble})`;
        if (sticks < 2) return 'craft sticks first with !craftRecipe("stick", 1)';
    }

    return null;
}

function evaluateCraft(item, recipeCount, inventory) {
    const planks = countPlanks(inventory);
    const logs = countLogs(inventory);
    const sticks = inventory.stick || 0;
    const craftingTables = inventory.crafting_table || 0;
    const recipes = mc.getItemCraftingRecipes(item);

    if (!recipes || recipes.length === 0) {
        const gatherHint = item === 'cobblestone'
            ? 'Cobblestone is mined, not crafted. Use !collectBlocks("stone", 4) with a pickaxe.'
            : `${item} is not craftable from a recipe right now. Use !inventory, !nearbyBlocks, !collectBlocks, or !getCraftingPlan for a craftable target.`;
        return {
            blocked: true,
            reason: `${item} does not have a crafting recipe.`,
            suggestion: gatherHint
        };
    }

    if (item === 'crafting_table' && craftingTables >= 1) {
        return {
            blocked: true,
            reason: 'You already have a crafting_table. Crafting another one wastes planks.',
            suggestion: 'Use the existing table and progress to tools, food, stone, shelter, or storage.'
        };
    }

    if (item === 'crafting_table' && recipeCount > 1) {
        return {
            blocked: true,
            reason: 'One crafting_table is enough for early survival.',
            suggestion: 'Use !craftRecipe("crafting_table", 1), then move on.'
        };
    }

    if (item === 'stick') {
        if (sticks >= 16) {
            return {
                blocked: true,
                reason: `You already have ${sticks} sticks. More sticks are not useful right now.`,
                suggestion: 'Spend the sticks on tools, torches, fences, or inspect inventory before crafting more.'
            };
        }

        if (recipeCount > 2) {
            return {
                blocked: true,
                reason: 'Crafting too many stick recipes creates clutter and wastes planks.',
                suggestion: 'Craft at most !craftRecipe("stick", 1) or !craftRecipe("stick", 2), then use them for a tool.'
            };
        }
    }

    if (item === 'torch') {
        if ((inventory.torch || 0) >= 16) {
            return {
                blocked: true,
                reason: `You already have ${inventory.torch} torches. More torches are inventory churn right now.`,
                suggestion: 'Follow the active objective planner instead of crafting more torches.'
            };
        }

        if (recipeCount > 1) {
            return {
                blocked: true,
                reason: 'Crafting multiple torch recipes at once often causes torch loops.',
                suggestion: 'Use !craftRecipe("torch", 1), then return to food, shelter, or iron progression.'
            };
        }
    }

    if (PICKAXES.includes(item) && highestToolTier(inventory, PICKAXES) >= toolTier(item)) {
        return {
            blocked: true,
            reason: `You already have an equal or better pickaxe. Duplicating ${item} is low-value.`,
            suggestion: 'Use the existing pickaxe to collect stone, coal, iron, or improve shelter.'
        };
    }

    if (AXES.includes(item) && highestToolTier(inventory, AXES) >= toolTier(item)) {
        return {
            blocked: true,
            reason: `You already have an equal or better axe. Duplicating ${item} is low-value.`,
            suggestion: 'Use the existing axe or switch to food, stone, or shelter progress.'
        };
    }

    if (SHOVELS.includes(item) && highestToolTier(inventory, SHOVELS) >= toolTier(item)) {
        return {
            blocked: true,
            reason: `You already have an equal or better shovel. Duplicating ${item} is low-value.`,
            suggestion: 'Use the existing shovel or choose a new survival milestone.'
        };
    }

    if (SWORDS.includes(item) && highestToolTier(inventory, SWORDS) >= toolTier(item)) {
        return {
            blocked: true,
            reason: `You already have an equal or better sword. Duplicating ${item} is low-value.`,
            suggestion: 'Use the existing weapon or improve food, armor, shelter, or tools.'
        };
    }

    if (HOES.includes(item) && highestToolTier(inventory, HOES) >= toolTier(item)) {
        return {
            blocked: true,
            reason: `You already have an equal or better hoe. Duplicating ${item} is low-value.`,
            suggestion: 'Use the existing hoe to till farmland or switch to food, shelter, or mining.'
        };
    }

    const missingToolPrerequisite = firstMissingToolPrerequisite(item, inventory);
    if (missingToolPrerequisite) {
        return {
            blocked: true,
            reason: `You cannot craft ${item} yet. Current basics: planks=${planks}, sticks=${sticks}, logs=${logs}, cobblestone=${inventory.cobblestone || 0}.`,
            suggestion: missingToolPrerequisite
        };
    }

    return null;
}

function evaluateWoodGathering(commandName, target, quantity, inventory) {
    const totalWoodPotential = countPlanks(inventory) + (countLogs(inventory) * 4) + Math.floor((inventory.stick || 0) / 2);
    const hasEarlyTools = hasAny(inventory, PICKAXES) && ((inventory.crafting_table || 0) > 0 || totalWoodPotential >= 4);

    if (target && isWoodBlock(target) && quantity > 8) {
        return {
            blocked: true,
            reason: `Requested ${quantity} logs at once. Early survival needs smaller batches and varied progress.`,
            suggestion: `Use !${commandName.substring(1)}("${target}", 4) or switch to crafting tools if you already have enough wood.`
        };
    }

    if (target && isWoodBlock(target) && hasEarlyTools && totalWoodPotential >= 16) {
        return {
            blocked: true,
            reason: 'You already have enough wood potential for the next milestone.',
            suggestion: 'Use your tools to collect stone, find food, remember a base, or build basic shelter.'
        };
    }

    return null;
}

function evaluateSmelting(item) {
    if (item === 'coal_ore') {
        return {
            blocked: true,
            reason: 'coal_ore is mined for coal; it is not a furnace input.',
            suggestion: 'Collect coal_ore with !collectBlocks("coal_ore", 1), then use the coal as fuel or craft torches.'
        };
    }

    if (item.endsWith('_ore') && !item.startsWith('raw_')) {
        return {
            blocked: true,
            reason: `${item} is an ore block, but this bot smelts raw materials like raw_iron, not ore blocks.`,
            suggestion: 'Mine the ore first, then smelt the raw material if one appears in inventory.'
        };
    }

    if (!mc.isSmeltable(item)) {
        return {
            blocked: true,
            reason: `${item} is not a useful smelting input.`,
            suggestion: 'Use !inventory and smelt only raw ores, food, logs for charcoal, sand, cobblestone, clay_ball, potato, or kelp.'
        };
    }

    return null;
}

export function evaluateAutonomousCommand(agent, message, commandName) {
    const parsed = parseCommandMessage(message);
    if (typeof parsed === 'string') return null;

    const inventory = world.getInventoryCounts(agent.bot);

    if (commandName === '!newAction' && settings.allow_insecure_coding !== true) {
        return {
            blocked: true,
            reason: 'newAction is disabled in settings, so it cannot help autonomous survival.',
            suggestion: 'Use available commands directly: !inventory, !nearbyBlocks, !collectBlocks, !craftRecipe, !searchForBlock, or !rememberHere.'
        };
    }

    if (commandName === '!searchWiki') {
        return {
            blocked: true,
            reason: 'Wiki search is poor for basic moment-to-moment survival decisions and can derail the loop.',
            suggestion: 'Use !inventory, !craftable, !getCraftingPlan, or gather the missing resource directly.'
        };
    }

    if (commandName === '!craftRecipe') {
        const [item, recipeCount] = parsed.args;
        return evaluateCraft(item, recipeCount, inventory);
    }

    if (commandName === '!smeltItem') {
        const [item] = parsed.args;
        return evaluateSmelting(item);
    }

    if (commandName === '!collectBlocks') {
        const [target, quantity] = parsed.args;
        if (PICKAXE_BLOCK_TARGETS.has(target) && highestToolTier(inventory, PICKAXES) < toolTier('wooden_pickaxe')) {
            return {
                blocked: true,
                reason: `Cannot collect ${target} without a pickaxe.`,
                suggestion: 'Finish the wooden tool chain first: collect wood, craft planks/table/sticks, then craft a wooden_pickaxe.'
            };
        }
        const guard = evaluateWoodGathering(commandName, target, quantity, inventory);
        if (guard) return guard;
    }

    if (commandName === '!searchForBlock') {
        const [target] = parsed.args;
        const guard = evaluateWoodGathering(commandName, target, 1, inventory);
        if (guard) return guard;
    }

    return evaluateObjectiveAlignment(agent, message, commandName);
}

export function getSurvivalMilestone(agent) {
    return getPlannedSurvivalMilestone(agent);
}
