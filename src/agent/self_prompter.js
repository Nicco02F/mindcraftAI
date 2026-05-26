const STOPPED = 0
const ACTIVE = 1
const PAUSED = 2
export class SelfPrompter {
    constructor(agent) {
        this.agent = agent;
        this.state = STOPPED;
        this.loop_active = false;
        this.interrupt = false;
        this.prompt = '';
        this.idle_time = 0;
        const profileCooldown = Number(agent?.prompter?.profile?.self_prompt_cooldown);
        this.cooldown = Number.isFinite(profileCooldown) && profileCooldown > 0 ? profileCooldown : 15000;
    }

    start(prompt) {
        console.log('Self-prompting started.');
        if (!prompt) {
            if (!this.prompt)
                return 'No prompt specified. Ignoring request.';
            prompt = this.prompt;
        }
        this.state = ACTIVE;
        this.prompt = prompt;
        this.startLoop();
    }

    isActive() {
        return this.state === ACTIVE;
    }

    isStopped() {
        return this.state === STOPPED;
    }

    isPaused() {
        return this.state === PAUSED;
    }

    async handleLoad(prompt, state) {
        if (state == undefined)
            state = STOPPED;
        this.state = state;
        this.prompt = prompt;
        if (state !== STOPPED && !prompt)
            throw new Error('No prompt loaded when self-prompting is active');
        if (state === ACTIVE) {
            await this.start(prompt);
        }
    }

    setPromptPaused(prompt) {
        this.prompt = prompt;
        this.state = PAUSED;
    }

    async startLoop() {
        if (this.loop_active) {
            console.warn('Self-prompt loop is already active. Ignoring request.');
            return;
        }
        console.log('starting self-prompt loop')
        this.loop_active = true;
        let no_command_count = 0;
        const MAX_NO_COMMAND = 3;
        while (!this.interrupt && this.state === ACTIVE) {
            let used_command = false;
            try {
                if (this.agent.prompter?.profile?.deterministic_autonomy !== false) {
                    used_command = await this.agent.executeAutonomousPlannerStep('self_prompt_loop');
                }

                if (!used_command) {
                    const objectivePlan = this.agent.objective_planner?.formatPrompt?.() || 'No objective planner available; inspect state and choose the next survival milestone.';
                    const msg = `You are self-prompting with the long-term goal: '${this.prompt}'.

Active dynamic microtask plan:
${objectivePlan}

Your next response MUST contain exactly one executable command with this syntax: !commandName. Review the latest action result first. Follow the active [now] microtask unless immediate safety requires a different command. If the microtask fails, choose a fallback inside the same objective instead of jumping to a new project. Respond:`;
                    used_command = await this.agent.handleMessage('system', msg, 1);
                }
            } catch (err) {
                const msg = `Self-prompt loop recovered from error: ${err?.message || err}`;
                console.error(msg);
                this.agent.memory_bank?.addEvent?.(msg, -5);
                this.agent.autonomy_logger?.log?.({
                    type: 'self_prompt_error',
                    error: err?.stack || String(err)
                });
            }

            if (!used_command) {
                no_command_count++;
                if (no_command_count >= MAX_NO_COMMAND) {
                    let out = `Agent did not use command in the last ${MAX_NO_COMMAND} auto-prompts. Stopping auto-prompting.`;
                    this.agent.openChat(out);
                    console.warn(out);
                    this.state = STOPPED;
                    break;
                }
            }
            else {
                no_command_count = 0;
                await new Promise(r => setTimeout(r, this.cooldown));
            }
        }
        console.log('self prompt loop stopped')
        this.loop_active = false;
        this.interrupt = false;
    }

    update(delta) {
        // automatically restarts loop
        if (this.state === ACTIVE && !this.loop_active && !this.interrupt) {
            if (this.agent.isIdle())
                this.idle_time += delta;
            else
                this.idle_time = 0;

            if (this.idle_time >= this.cooldown) {
                console.log('Restarting self-prompting...');
                this.startLoop();
                this.idle_time = 0;
            }
        }
        else {
            this.idle_time = 0;
        }
    }

    async stopLoop() {
        // you can call this without await if you don't need to wait for it to finish
        if (!this.loop_active) {
            this.interrupt = false;
            return;
        }
        console.log('stopping self-prompt loop')
        this.interrupt = true;
        while (this.loop_active) {
            await new Promise(r => setTimeout(r, 500));
        }
        this.interrupt = false;
    }

    async stop(stop_action=true) {
        if (stop_action)
            await this.agent.actions.stop();
        await this.stopLoop();
        this.state = STOPPED;
    }

    async pause() {
        await this.agent.actions.stop();
        await this.stopLoop();
        this.state = PAUSED;
    }

    shouldInterrupt(is_self_prompt) { // to be called from handleMessage
        return is_self_prompt && (this.state === ACTIVE || this.state === PAUSED) && this.interrupt;
    }

    handleUserPromptedCmd(is_self_prompt, is_action) {
        // if a user messages and the bot responds with an action, stop the self-prompt loop
        if (!is_self_prompt && is_action) {
            this.stopLoop();
            // this stops it from responding from the handlemessage loop and the self-prompt loop at the same time
        }
    }
}
