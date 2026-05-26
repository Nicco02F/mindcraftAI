import fs from 'fs';
import path from 'path';
import * as world from './library/world.js';
import * as mc from '../utils/mcdata.js';

export const WOOD_BLOCKS = [
    'oak_log',
    'spruce_log',
    'birch_log',
    'jungle_log',
    'acacia_log',
    'dark_oak_log',
    'mangrove_log',
    'cherry_log',
    'pale_oak_log',
    'crimson_stem',
    'warped_stem'
];
export const OVERWORLD_WOOD_BLOCKS = WOOD_BLOCKS.filter(name => !['crimson_stem', 'warped_stem'].includes(name));
export const NETHER_WOOD_BLOCKS = ['crimson_stem', 'warped_stem'];
export const GENERIC_WOOD_TARGET = '_log';

export const BIOME_WOOD_BLOCKS = Object.freeze({
    badlands: [],
    bamboo_jungle: ['jungle_log'],
    basalt_deltas: [],
    beach: [],
    birch_forest: ['birch_log'],
    cherry_grove: ['cherry_log'],
    cold_ocean: [],
    crimson_forest: ['crimson_stem'],
    dark_forest: ['dark_oak_log'],
    deep_cold_ocean: [],
    deep_dark: [],
    deep_frozen_ocean: [],
    deep_lukewarm_ocean: [],
    deep_ocean: [],
    desert: [],
    dripstone_caves: [],
    end_barrens: [],
    end_highlands: [],
    end_midlands: [],
    eroded_badlands: [],
    flower_forest: ['oak_log', 'birch_log'],
    forest: ['oak_log', 'birch_log'],
    frozen_ocean: [],
    frozen_peaks: [],
    frozen_river: [],
    grove: ['spruce_log'],
    ice_spikes: [],
    jagged_peaks: [],
    jungle: ['jungle_log'],
    lukewarm_ocean: [],
    lush_caves: [],
    mangrove_swamp: ['mangrove_log'],
    meadow: ['oak_log', 'birch_log'],
    mushroom_fields: [],
    nether_wastes: [],
    ocean: [],
    old_growth_birch_forest: ['birch_log'],
    old_growth_pine_taiga: ['spruce_log'],
    old_growth_spruce_taiga: ['spruce_log'],
    pale_garden: ['pale_oak_log'],
    plains: ['oak_log'],
    river: [],
    savanna: ['acacia_log'],
    savanna_plateau: ['acacia_log'],
    small_end_islands: [],
    snowy_beach: [],
    snowy_plains: [],
    snowy_slopes: [],
    snowy_taiga: ['spruce_log'],
    soul_sand_valley: [],
    sparse_jungle: ['jungle_log'],
    stony_peaks: [],
    stony_shore: [],
    sunflower_plains: ['oak_log'],
    swamp: ['oak_log'],
    taiga: ['spruce_log'],
    the_end: [],
    the_void: [],
    warm_ocean: [],
    warped_forest: ['warped_stem'],
    windswept_forest: ['spruce_log', 'oak_log'],
    windswept_gravelly_hills: ['spruce_log', 'oak_log'],
    windswept_hills: ['spruce_log', 'oak_log'],
    windswept_savanna: ['acacia_log'],
    wooded_badlands: ['oak_log']
});

export const FOOD_MOBS = ['cow', 'pig', 'sheep', 'chicken', 'rabbit'];
const HAZARD_BLOCKS = ['lava', 'fire', 'magma_block', 'cactus', 'powder_snow'];
const USEFUL_BLOCKS = [
    'stone',
    'coal_ore',
    'iron_ore',
    'deepslate_iron_ore',
    'water',
    'crafting_table',
    'furnace',
    'chest',
    'bed'
];

function unique(items) {
    return [...new Set(items.filter(Boolean))];
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function validBlocks(names) {
    return names.filter(name => {
        try {
            return mc.getBlockId(name) !== null;
        } catch {
            return false;
        }
    });
}

function rememberMany(existing, incoming, limit = 24) {
    return unique([...safeArray(existing), ...safeArray(incoming)]).slice(0, limit);
}

function timeSegment(bot) {
    const time = bot?.time?.timeOfDay ?? 6000;
    if (time < 6000) return 'morning';
    if (time < 12000) return 'afternoon';
    return 'night';
}

function regionKey(snapshot) {
    const x = Math.floor((snapshot.position?.x ?? 0) / 64);
    const z = Math.floor((snapshot.position?.z ?? 0) / 64);
    return `${snapshot.dimension || 'unknown'}:${x},${z}:${snapshot.biome || 'unknown'}`;
}

function nearestBlockNames(bot, names, range = 32, count = 32) {
    const valid = validBlocks(names);
    if (valid.length === 0) return [];

    try {
        return unique(world.getNearestBlocks(bot, valid, range, count).map(block => block?.name));
    } catch {
        return [];
    }
}

function nearbyEntityNames(bot, range = 32) {
    try {
        return unique(world.getNearbyEntities(bot, range).map(entity => entity?.name));
    } catch {
        return [];
    }
}

function safeBiome(bot) {
    try {
        return world.getBiomeName(bot);
    } catch {
        return 'unknown';
    }
}

function failed(memoryBank, command, target) {
    return memoryBank?.shouldAbortAction?.(`${command}:${target}`) ||
        (memoryBank?.failedAttempts?.[`${command}:${target}`] || 0) >= 2;
}

export function isWoodBlock(name) {
    return isGenericWoodTarget(name) || /(_log|_wood|_stem|_hyphae)$/.test(String(name || ''));
}

export function isGenericWoodTarget(name) {
    return ['_log', 'log', 'any_log', 'any_wood'].includes(String(name || '').toLowerCase());
}

export function woodBlocksForDimension(dimension = 'overworld') {
    dimension = String(dimension || '').toLowerCase();
    if (dimension.includes('nether')) return NETHER_WOOD_BLOCKS;
    return OVERWORLD_WOOD_BLOCKS;
}

export function isWoodValidForDimension(name, dimension = 'overworld') {
    if (isGenericWoodTarget(name)) return true;
    return woodBlocksForDimension(dimension).includes(name);
}

function normalizeBiomeName(biome) {
    return String(biome || 'unknown')
        .toLowerCase()
        .replace(/^minecraft:/, '')
        .replace(/\s+/g, '_');
}

export function woodBlocksForBiome(biome, dimension = 'overworld') {
    const normalized = normalizeBiomeName(biome);
    const dimensionWood = woodBlocksForDimension(dimension);
    const mapped = BIOME_WOOD_BLOCKS[normalized];
    if (Array.isArray(mapped)) {
        return mapped.filter(name => dimensionWood.includes(name));
    }

    if (normalized.includes('crimson')) return ['crimson_stem'];
    if (normalized.includes('warped')) return ['warped_stem'];
    if (String(dimension || '').toLowerCase().includes('nether')) return [];
    if (normalized.includes('pale')) return ['pale_oak_log'];
    if (normalized.includes('mangrove')) return ['mangrove_log'];
    if (normalized.includes('cherry')) return ['cherry_log'];
    if (normalized.includes('jungle') || normalized.includes('bamboo')) return ['jungle_log'];
    if (normalized.includes('savanna')) return ['acacia_log'];
    if (normalized.includes('birch')) return ['birch_log'];
    if (normalized.includes('dark_forest')) return ['dark_oak_log'];
    if (normalized.includes('taiga') || normalized === 'grove') return ['spruce_log'];
    if (normalized.includes('forest')) return ['oak_log', 'birch_log'];
    if (normalized.includes('plains') || normalized === 'meadow' || normalized === 'swamp') return ['oak_log'];

    return [];
}

export class WorldModel {
    constructor(agent) {
        this.agent = agent;
        this.stateFile = path.join(agent.memory_bank.memoryDir, 'world_model.json');
        this.state = this.loadState();
        this.lastObservedAt = 0;
    }

    defaultState() {
        return {
            version: 1,
            current_area: null,
            regions: {},
            observed_resources: {
                wood: [],
                food_mobs: [],
                hazards: [],
                useful_blocks: []
            },
            projects: [],
            last_updated: null
        };
    }

    loadState() {
        try {
            if (fs.existsSync(this.stateFile)) {
                return { ...this.defaultState(), ...JSON.parse(fs.readFileSync(this.stateFile, 'utf-8')) };
            }
        } catch (err) {
            console.error(`Error loading world model from ${this.stateFile}:`, err);
        }
        return this.defaultState();
    }

    saveState() {
        try {
            fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
        } catch (err) {
            console.error(`Error saving world model to ${this.stateFile}:`, err);
        }
    }

    observeSnapshot() {
        const bot = this.agent?.bot;
        if (!bot?.entity?.position) return null;

        const pos = bot.entity.position;
        const snapshot = {
            observed_at: new Date().toISOString(),
            position: {
                x: Number(pos.x.toFixed(1)),
                y: Number(pos.y.toFixed(1)),
                z: Number(pos.z.toFixed(1))
            },
            dimension: bot.game?.dimension || 'unknown',
            biome: safeBiome(bot),
            time: timeSegment(bot),
            health: Math.round(bot.health ?? 20),
            hunger: Math.round(bot.food ?? 20),
            nearby: {
                wood: nearestBlockNames(bot, WOOD_BLOCKS, 40, 16),
                food_mobs: nearbyEntityNames(bot, 40).filter(name => FOOD_MOBS.includes(name)),
                hazards: nearestBlockNames(bot, HAZARD_BLOCKS, 24, 12),
                useful_blocks: nearestBlockNames(bot, USEFUL_BLOCKS, 32, 24)
            }
        };

        return snapshot;
    }

    updateFromAgent({ force = false } = {}) {
        const now = Date.now();
        if (!force && now - this.lastObservedAt < 5000) {
            return this.state;
        }

        const snapshot = this.observeSnapshot();
        if (!snapshot) return this.state;

        this.lastObservedAt = now;
        this.state.current_area = snapshot;
        this.state.observed_resources.wood = rememberMany(this.state.observed_resources.wood, snapshot.nearby.wood);
        this.state.observed_resources.food_mobs = rememberMany(this.state.observed_resources.food_mobs, snapshot.nearby.food_mobs);
        this.state.observed_resources.hazards = rememberMany(this.state.observed_resources.hazards, snapshot.nearby.hazards);
        this.state.observed_resources.useful_blocks = rememberMany(this.state.observed_resources.useful_blocks, snapshot.nearby.useful_blocks);

        const key = regionKey(snapshot);
        const region = this.state.regions[key] || {
            key,
            biome: snapshot.biome,
            dimension: snapshot.dimension,
            visits: 0,
            wood_seen: [],
            food_mobs_seen: [],
            hazards_seen: [],
            useful_blocks_seen: [],
            first_seen: snapshot.observed_at
        };

        region.visits += 1;
        region.last_seen = snapshot.observed_at;
        region.last_position = snapshot.position;
        region.wood_seen = rememberMany(region.wood_seen, snapshot.nearby.wood);
        region.food_mobs_seen = rememberMany(region.food_mobs_seen, snapshot.nearby.food_mobs);
        region.hazards_seen = rememberMany(region.hazards_seen, snapshot.nearby.hazards);
        region.useful_blocks_seen = rememberMany(region.useful_blocks_seen, snapshot.nearby.useful_blocks);
        this.state.regions[key] = region;
        this.state.last_updated = snapshot.observed_at;
        this.saveState();
        return this.state;
    }

    getCurrentRegion() {
        const snapshot = this.state.current_area;
        if (!snapshot) return null;
        return this.state.regions[regionKey(snapshot)] || null;
    }

    getPreferredWoodTarget() {
        this.updateFromAgent();
        const memory = this.agent?.memory_bank;
        const region = this.getCurrentRegion();
        const dimension = this.state.current_area?.dimension || 'overworld';
        const biome = this.state.current_area?.biome || 'unknown';
        const biomeWood = validBlocks(woodBlocksForBiome(biome, dimension))
            .filter(name => isWoodValidForDimension(name, dimension));
        const biomeHasNativeWood = biomeWood.length > 0;
        const actualNearbyWood = unique([
            ...safeArray(this.state.current_area?.nearby?.wood),
            ...safeArray(region?.wood_seen)
        ]).filter(name =>
            isWoodValidForDimension(name, dimension) &&
            (!biomeHasNativeWood || biomeWood.includes(name))
        );
        const candidates = unique([
            ...actualNearbyWood,
            ...biomeWood
        ]);

        const preferred = candidates.find(name =>
            isWoodBlock(name) &&
            isWoodValidForDimension(name, dimension) &&
            !failed(memory, '!collectBlocks', name) &&
            !failed(memory, '!searchForBlock', name)
        );

        return preferred || GENERIC_WOOD_TARGET;
    }

    getPreferredFoodMob() {
        this.updateFromAgent();
        const memory = this.agent?.memory_bank;
        const region = this.getCurrentRegion();
        const candidates = unique([
            ...safeArray(this.state.current_area?.nearby?.food_mobs),
            ...safeArray(region?.food_mobs_seen),
            ...safeArray(this.state.observed_resources?.food_mobs),
            ...FOOD_MOBS
        ]);

        return candidates.find(name =>
            FOOD_MOBS.includes(name) &&
            !failed(memory, '!searchForEntity', name) &&
            !failed(memory, '!attack', name)
        ) || candidates.find(name => FOOD_MOBS.includes(name)) || 'cow';
    }

    formatPromptSummary() {
        this.updateFromAgent();
        const area = this.state.current_area;
        const region = this.getCurrentRegion();
        if (!area) return 'World model: no observations yet.';

        return [
            `Current area: biome=${area.biome}, dimension=${area.dimension}, time=${area.time}, position=${JSON.stringify(area.position)}`,
            `Nearby useful resources: wood=${safeArray(area.nearby?.wood).join(', ') || 'none'}, food_mobs=${safeArray(area.nearby?.food_mobs).join(', ') || 'none'}, useful_blocks=${safeArray(area.nearby?.useful_blocks).join(', ') || 'none'}, hazards=${safeArray(area.nearby?.hazards).join(', ') || 'none'}`,
            `Current region memory: visits=${region?.visits || 0}, wood_seen=${safeArray(region?.wood_seen).join(', ') || 'none'}, food_seen=${safeArray(region?.food_mobs_seen).join(', ') || 'none'}, hazards_seen=${safeArray(region?.hazards_seen).join(', ') || 'none'}`,
            `Dynamic preferences: preferred_wood=${this.getPreferredWoodTarget()}, preferred_food_mob=${this.getPreferredFoodMob()}`
        ].join('\n');
    }
}
