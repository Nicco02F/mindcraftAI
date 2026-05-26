import fs from 'fs';
import path from 'path';
import * as world from './library/world.js';

function safeReadArray(filePath) {
    try {
        if (!fs.existsSync(filePath)) return [];
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return Array.isArray(data) ? data : [];
    } catch (err) {
        console.error(`Error reading autonomy log ${filePath}:`, err);
        return [];
    }
}

function compactInventory(agent) {
    try {
        return world.getInventoryCounts(agent.bot);
    } catch {
        return {};
    }
}

function compactPosition(agent) {
    const pos = agent?.bot?.entity?.position;
    if (!pos) return null;
    return {
        x: Number(pos.x.toFixed(2)),
        y: Number(pos.y.toFixed(2)),
        z: Number(pos.z.toFixed(2))
    };
}

export class AutonomyLogger {
    constructor(agent) {
        this.agent = agent;
        this.file = path.join(agent.memory_bank.memoryDir, 'autonomy_trace.json');
        this.maxEntries = 1000;
        this.events = safeReadArray(this.file);
        this.save();
    }

    save() {
        try {
            fs.writeFileSync(this.file, JSON.stringify(this.events, null, 2));
        } catch (err) {
            console.error(`Error saving autonomy log ${this.file}:`, err);
        }
    }

    log(event) {
        let plan = this.agent.objective_planner?.state?.snapshot || null;
        if (!plan && this.agent.objective_planner?.getPlan) {
            try {
                const livePlan = this.agent.objective_planner.getPlan();
                plan = {
                    objective_id: livePlan.objective_id,
                    objective: livePlan.objective,
                    active_microtask: livePlan.active_task?.text || null,
                    suggested_command: livePlan.active_task?.command || null
                };
            } catch {/* logging must never break action flow */}
        }
        const record = {
            timestamp: new Date().toISOString(),
            type: event.type || 'event',
            source: event.source || 'unknown',
            objective_id: plan?.objective_id || null,
            objective: plan?.objective || null,
            active_microtask: plan?.active_microtask || null,
            suggested_command: plan?.suggested_command || null,
            position: compactPosition(this.agent),
            health: Math.round(this.agent?.bot?.health ?? 20),
            hunger: Math.round(this.agent?.bot?.food ?? 20),
            inventory: compactInventory(this.agent),
            failures: { ...(this.agent.memory_bank?.failedAttempts || {}) },
            ...event
        };

        if (record.result && String(record.result).length > 1200) {
            record.result = String(record.result).slice(0, 1200) + '...';
        }

        this.events.push(record);
        if (this.events.length > this.maxEntries) {
            this.events.splice(0, this.events.length - this.maxEntries);
        }
        this.save();
        return record;
    }
}
