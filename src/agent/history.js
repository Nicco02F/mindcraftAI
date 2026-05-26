import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { NPCData } from './npc/data.js';
import settings from './settings.js';


export class History {
    constructor(agent) {
        this.agent = agent;
        this.name = agent.name;
        this.memory_fp = `./bots/${this.name}/memory.json`;
        this.full_history_fp = undefined;

        mkdirSync(`./bots/${this.name}/histories`, { recursive: true });

        this.turns = [];

        // Natural language memory as a summary of recent messages + previous memory
        this.memory = '';

        // Maximum number of messages to keep in context before saving chunk to memory
        this.max_messages = settings.max_messages;

        // Number of messages to remove from current history and save into memory
        this.summary_chunk_size = 5; 
        // chunking reduces expensive calls to promptMemSaving and appendFullHistory
        // and improves the quality of the memory summary
    }

    getHistory() { // expects an Examples object
        return JSON.parse(JSON.stringify(this.turns));
    }

    async summarizeMemories(turns) {
        console.log("Storing memories...");
        this.memory = this.sanitizeMemorySummary(await this.agent.prompter.promptMemSaving(turns), turns);

        if (this.memory.length > 500) {
            this.memory = this.memory.slice(0, 500);
            this.memory += '...(Memory truncated to 500 chars. Compress it more next time)';
        }

        console.log("Memory updated to: ", this.memory);
    }

    sanitizeMemorySummary(summary, turns) {
        summary = String(summary || '').trim();
        summary = summary.replace(/!\w+(?:\([^)]*\))?/g, '').trim();
        const source = turns.map(turn => String(turn.content || '')).join('\n').toLowerCase();

        let fragments = summary
            .split(/(?<=[.!?])\s+|\n+/)
            .map(fragment => fragment.trim())
            .filter(Boolean);

        fragments = fragments.filter(fragment => {
            const text = fragment.toLowerCase();

            if (/\b(navigating|moving|searching|collecting|crafting|mining|attacking)\b/.test(text)) {
                return false;
            }

            if (/\b(to mine|to collect|to craft|next step|now i|i need|need to)\b/.test(text)) {
                return false;
            }

            const coords = text.match(/-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?/g) || [];
            for (const coord of coords) {
                if (!source.includes(coord)) return false;
            }

            if (text.includes('diamond') && !source.includes('diamond')) {
                return false;
            }

            if (text.includes('next') && text.includes('diamond') && !source.includes('iron_pickaxe')) {
                return false;
            }

            if (text.includes('mangrove') && !source.includes('mangrove')) {
                return false;
            }

            if (text.includes('can be converted') && !source.includes('successfully crafted')) {
                return false;
            }

            if (text.includes('already have') && !source.includes('you already have') && !source.includes('you now have')) {
                return false;
            }

            if (/^(okay|ok|let's|lets|time to|i should|i will|i'll)\b/.test(text)) {
                return false;
            }

            if (text.includes('action output') ||
                text.includes('it requires:') ||
                text.includes('you do not have the resources') ||
                text.includes("don't have right tools") ||
                text.includes('produced no action output') ||
                text.includes('collected 0') ||
                text.includes('failed collectblocks') ||
                text.includes('trauma:') ||
                text.includes('runtime exception') ||
                text.includes("cannot read properties") ||
                text.includes('attempting collectblocks')) {
                return false;
            }

            return true;
        });

        return fragments.join(' ').slice(0, 500);
    }

    sanitizeLoadedTurns(turns) {
        const maxLoadedTurns = Math.max(Number(this.max_messages) || 0, 12);
        const failedActions = this.agent?.memory_bank?.failedAttempts || {};

        return (Array.isArray(turns) ? turns : [])
            .filter(turn => {
                const content = String(turn?.content || '');
                const lower = content.toLowerCase();

                if (!content.trim()) return false;
                if (content.includes('Your next response MUST contain exactly one executable command') &&
                    content.includes('Active dynamic microtask plan')) {
                    return false;
                }
                if (lower.startsWith('memory warning:')) {
                    return false;
                }
                if (turn.role === 'assistant' && /^!\w+/.test(content.trim())) {
                    const commandMatch = content.match(/^!(\w+)(?:\((.*)\))?/);
                    const commandName = commandMatch ? `!${commandMatch[1]}` : null;
                    const args = commandMatch?.[2] || '';
                    const firstStringArg = args.match(/"([^"]+)"/)?.[1] || args.match(/'([^']+)'/)?.[1] || null;
                    const actionKey = firstStringArg ? `${commandName}:${firstStringArg}` : commandName;
                    if (failedActions[actionKey] >= 2) return false;
                }
                return true;
            })
            .slice(-maxLoadedTurns);
    }

    async appendFullHistory(to_store) {
        if (this.full_history_fp === undefined) {
            const string_timestamp = new Date().toLocaleString().replace(/[/:]/g, '-').replace(/ /g, '').replace(/,/g, '_');
            this.full_history_fp = `./bots/${this.name}/histories/${string_timestamp}.json`;
            writeFileSync(this.full_history_fp, '[]', 'utf8');
        }
        try {
            const data = readFileSync(this.full_history_fp, 'utf8');
            let full_history = JSON.parse(data);
            full_history.push(...to_store);
            writeFileSync(this.full_history_fp, JSON.stringify(full_history, null, 4), 'utf8');
        } catch (err) {
            console.error(`Error reading ${this.name}'s full history file: ${err.message}`);
        }
    }

    async add(name, content) {
        let role = 'assistant';
        if (name === 'system') {
            role = 'system';
        }
        else if (name !== this.name) {
            role = 'user';
            content = `${name}: ${content}`;
        }
        this.turns.push({role, content});

        if (this.turns.length >= this.max_messages) {
            let chunk = this.turns.splice(0, this.summary_chunk_size);
            while (this.turns.length > 0 && this.turns[0].role === 'assistant')
                chunk.push(this.turns.shift()); // remove until turns starts with system/user message

            await this.summarizeMemories(chunk);
            await this.appendFullHistory(chunk);
        }
    }

    async save() {
        try {
            const data = {
                memory: this.memory,
                turns: this.turns,
                self_prompting_state: this.agent.self_prompter.state,
                self_prompt: this.agent.self_prompter.isStopped() ? null : this.agent.self_prompter.prompt,
                taskStart: this.agent.task.taskStartTime,
                last_sender: this.agent.last_sender
            };
            writeFileSync(this.memory_fp, JSON.stringify(data, null, 2));
            console.log('Saved memory to:', this.memory_fp);
        } catch (error) {
            console.error('Failed to save history:', error);
            throw error;
        }
    }

    load() {
        try {
            if (!existsSync(this.memory_fp)) {
                console.log('No memory file found.');
                return null;
            }
            const data = JSON.parse(readFileSync(this.memory_fp, 'utf8'));
            this.turns = this.sanitizeLoadedTurns(data.turns || []);
            this.memory = this.sanitizeMemorySummary(data.memory || '', this.turns);
            console.log('Loaded memory:', this.memory);
            return data;
        } catch (error) {
            console.error('Failed to load history:', error);
            throw error;
        }
    }

    clear() {
        this.turns = [];
        this.memory = '';
    }
}
