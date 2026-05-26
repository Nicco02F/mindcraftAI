import fs from 'fs';
import path from 'path';
import * as world from './library/world.js';

const ARMOR_SUFFIXES = ['helmet', 'chestplate', 'leggings', 'boots'];
const TOOL_SUFFIXES = ['pickaxe', 'axe', 'shovel', 'hoe', 'sword'];
const FOOD_ITEMS = new Set([
    'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken', 'cooked_rabbit',
    'cooked_cod', 'cooked_salmon', 'bread', 'apple', 'carrot', 'baked_potato', 'potato',
    'beetroot', 'melon_slice', 'sweet_berries', 'pumpkin_pie', 'beef', 'porkchop', 'mutton',
    'chicken', 'rabbit', 'cod', 'salmon'
]);
const RARE_OR_CORE = new Set([
    'diamond', 'emerald', 'ancient_debris', 'netherite_scrap', 'iron_ingot', 'raw_iron',
    'gold_ingot', 'raw_gold', 'coal', 'charcoal', 'lapis_lazuli', 'redstone', 'ender_pearl',
    'blaze_rod', 'shield', 'bucket', 'water_bucket', 'lava_bucket', 'bed', 'furnace',
    'crafting_table', 'chest', 'torch'
]);
const LOW_VALUE_PATTERNS = [
    /^(dirt|coarse_dirt|rooted_dirt|grass_block|sand|red_sand|gravel|cobblestone|cobbled_deepslate)$/,
    /(_leaves|_sapling|flower|tulip|dandelion|poppy|grass|fern|seed)$/,
    /^(rotten_flesh|spider_eye|poisonous_potato|flint)$/
];

function safeReadObject(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch (err) {
        console.error(`Error reading inventory state from ${filePath}:`, err);
        return fallback;
    }
}

function itemCount(inventory, predicate) {
    return Object.entries(inventory)
        .filter(([name]) => predicate(name))
        .reduce((sum, [, count]) => sum + count, 0);
}

function isTool(name) {
    return TOOL_SUFFIXES.some(suffix => String(name || '').endsWith(`_${suffix}`));
}

function isArmor(name) {
    return ARMOR_SUFFIXES.some(suffix => String(name || '').endsWith(`_${suffix}`));
}

function isLog(name) {
    return /(_log|_wood|_stem|_hyphae)$/.test(String(name || ''));
}

export class InventoryManager {
    constructor(agent) {
        this.agent = agent;
        this.file = path.join(agent.memory_bank.memoryDir, 'inventory_state.json');
        this.state = this.normalizeState(safeReadObject(this.file, this.defaultState()));
        this.save();
    }

    defaultState() {
        return {
            version: 1,
            last_pressure: null,
            last_suggestion: null,
            updated_at: null
        };
    }

    normalizeState(state) {
        return { ...this.defaultState(), ...state };
    }

    save() {
        try {
            fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2));
        } catch (err) {
            console.error(`Error saving inventory state ${this.file}:`, err);
        }
    }

    getSlotStats() {
        const bot = this.agent?.bot;
        const slots = bot?.inventory?.slots || [];
        const inventorySlots = slots.slice(9, 45);
        const occupied = inventorySlots.filter(Boolean).length;
        const empty = Math.max(0, inventorySlots.length - occupied);
        return {
            occupied,
            empty,
            capacity: inventorySlots.length,
            pressure: inventorySlots.length > 0 ? occupied / inventorySlots.length : 0
        };
    }

    scoreItem(name, count = 1) {
        name = String(name || '');
        if (!name) return 0;
        if (RARE_OR_CORE.has(name)) return 90;
        if (FOOD_ITEMS.has(name)) return 75;
        if (isArmor(name)) return 80;
        if (isTool(name)) return 78;
        if (isLog(name) || name.endsWith('_planks') || name === 'stick') return 55;
        if (name.includes('ore')) return 70;
        if (LOW_VALUE_PATTERNS.some(pattern => pattern.test(name))) return count > 32 ? 8 : 18;
        if (name.includes('wool') || name.includes('leather') || name === 'string') return 45;
        return 35;
    }

    classifyInventory() {
        const inventory = world.getInventoryCounts(this.agent.bot);
        const items = Object.entries(inventory)
            .map(([name, count]) => ({
                name,
                count,
                value: this.scoreItem(name, count)
            }))
            .sort((a, b) => a.value - b.value || b.count - a.count);

        const slots = this.getSlotStats();
        return {
            inventory,
            slots,
            lowValue: items.filter(item => item.value <= 20),
            overflow: items.filter(item => item.count > 32 && item.value < 60),
            core: items.filter(item => item.value >= 70)
        };
    }

    getManagementTask(facts = {}) {
        const analysis = this.classifyInventory();
        const slots = analysis.slots;
        const inventory = analysis.inventory;
        const hasNearbyChest = Boolean(facts.chestPlaced || world.getNearestBlock(this.agent.bot, ['chest', 'barrel', 'trapped_chest'], 16));
        let suggestion = null;

        if (slots.empty > 3 && slots.pressure < 0.9) {
            this.state.last_pressure = slots;
            this.state.last_suggestion = null;
            this.save();
            return null;
        }

        const storageCandidate = [...analysis.overflow, ...analysis.lowValue]
            .find(item => item.count > 0 && !RARE_OR_CORE.has(item.name) && !FOOD_ITEMS.has(item.name));

        if (hasNearbyChest && storageCandidate) {
            const amount = Math.min(storageCandidate.count, Math.max(1, storageCandidate.count - 16));
            suggestion = {
                id: 'store_overflow',
                text: `Store low-value overflow ${storageCandidate.name} to free inventory slots.`,
                command: `!putInChest("${storageCandidate.name}", ${amount})`,
                status: 'pending',
                reason: `Inventory pressure is ${(slots.pressure * 100).toFixed(0)}% with ${slots.empty} empty slots.`
            };
        } else if (!hasNearbyChest && (inventory.chest || 0) > 0) {
            suggestion = {
                id: 'place_storage',
                text: 'Place a chest because inventory is nearly full.',
                command: '!placeHere("chest")',
                status: 'pending',
                reason: `Inventory pressure is ${(slots.pressure * 100).toFixed(0)}% and a chest is available.`
            };
        } else if (!hasNearbyChest && itemCount(inventory, isLog) >= 2) {
            const plankName = Object.keys(inventory).find(isLog)?.replace(/_(log|wood|stem|hyphae)$/, '_planks') || 'oak_planks';
            suggestion = {
                id: 'craft_storage_prereq',
                text: 'Craft planks toward a chest because inventory is nearly full.',
                command: `!craftRecipe("${plankName}", 1)`,
                status: 'pending',
                reason: 'A chest would let the bot store overflow instead of discarding resources.'
            };
        } else if ((inventory.chest || 0) === 0 && !hasNearbyChest && itemCount(inventory, name => name.endsWith('_planks')) >= 8) {
            suggestion = {
                id: 'craft_storage',
                text: 'Craft a chest because inventory is nearly full.',
                command: '!craftRecipe("chest", 1)',
                status: 'pending',
                reason: 'Storage is better than discarding useful items.'
            };
        } else if (analysis.lowValue.length > 0) {
            const discard = analysis.lowValue[0];
            suggestion = {
                id: 'discard_junk',
                text: `Discard low-value clutter ${discard.name}.`,
                command: `!discard("${discard.name}", ${Math.min(discard.count, 16)})`,
                status: 'pending',
                reason: `Inventory has ${slots.empty} empty slots and no storage path is available.`
            };
        }

        this.state.last_pressure = slots;
        this.state.last_suggestion = suggestion;
        this.state.updated_at = new Date().toISOString();
        this.save();
        return suggestion;
    }

    formatPromptSummary() {
        const analysis = this.classifyInventory();
        const slots = analysis.slots;
        const keep = analysis.core.slice(0, 8).map(item => `${item.name}:${item.count}`).join(', ') || 'none';
        const low = analysis.lowValue.slice(0, 8).map(item => `${item.name}:${item.count}`).join(', ') || 'none';
        const suggestion = this.state.last_suggestion;

        return [
            `Inventory pressure: occupied=${slots.occupied}/${slots.capacity}, empty=${slots.empty}, pressure=${slots.pressure.toFixed(2)}`,
            `High-value keep items: ${keep}`,
            `Low-value storage/discard candidates: ${low}`,
            `Inventory policy suggestion: ${suggestion ? `${suggestion.text} -> ${suggestion.command}` : 'no urgent inventory action'}`
        ].join('\n');
    }
}
