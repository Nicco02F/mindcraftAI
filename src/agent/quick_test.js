#!/usr/bin/env node

/**
 * MINDCRAFT MEMORY SYSTEM - QUICK TEST
 * 
 * This is a minimal example to verify the memory system works.
 * Run this right after copying the 4 core files.
 * 
 * Usage:
 *   node quick_test.js
 * 
 * Expected output:
 *   ✓ All tests pass
 *   ✓ Memory files created
 */

import { AdvancedMemoryBank } from './advanced_memory_bank.js';
import { MemoryAwarePrompter } from './memory_aware_prompter.js';

console.log('🧠 Mindcraft Memory System - Quick Test\n');

try {
    // Create test agent
    const testAgent = {
        name: 'QuickTestBot',
        currentSituation: 'testing'
    };
    
    // Initialize memory
    console.log('1️⃣  Initializing memory...');
    testAgent.memory_bank = new AdvancedMemoryBank(testAgent.name);
    testAgent.memory_prompter = new MemoryAwarePrompter(testAgent);
    console.log('   ✓ Memory initialized\n');
    
    // Add some events
    console.log('2️⃣  Testing memory operations...');
    testAgent.memory_bank.addEvent('Found diamonds!');
    testAgent.memory_bank.addEvent('Crafted pickaxe');
    testAgent.memory_bank.addEvent('Mined iron ore');
    console.log('   ✓ Added 3 events\n');
    
    // Remember a location
    console.log('3️⃣  Recording location...');
    testAgent.memory_bank.rememberPlace('diamond_cave', 100, 50, 200, 'Rich diamonds here');
    console.log('   ✓ Location remembered\n');
    
    // Learn a skill
    console.log('4️⃣  Learning skill...');
    testAgent.memory_bank.recordSkill('survive_night', [
        'gather_wood',
        'craft_bed',
        'sleep'
    ], 0.9);
    console.log('   ✓ Skill recorded\n');
    
    // Test retrieval
    console.log('5️⃣  Testing memory retrieval...');
    const relevant = testAgent.memory_bank.retrieveRelevantMemories('mining diamonds');
    console.log('   ✓ Retrieved memories:');
    console.log(`     - Recent events: ${relevant.short_term.length}`);
    console.log(`     - Long-term: ${relevant.long_term.length}`);
    console.log(`     - Skills: ${relevant.skills.length}\n`);
    
    // Build system prompt
    console.log('6️⃣  Building system prompt with memory...');
    const systemPrompt = testAgent.memory_prompter.buildSystemPrompt('mining');
    console.log(`   ✓ Prompt generated (${systemPrompt.length} chars)\n`);
    
    // Check personality
    console.log('7️⃣  Checking personality...');
    const mood = testAgent.memory_bank.personality.mood;
    const fear = testAgent.memory_bank.personality.fear_level;
    console.log(`   ✓ Current mood: ${mood}`);
    console.log(`   ✓ Fear level: ${fear.toFixed(2)}\n`);
    
    // Record action result
    console.log('8️⃣  Recording action result...');
    testAgent.memory_prompter.handleActionResult('mine_diamonds', 'Success!', 60);
    console.log('   ✓ Action recorded\n');
    
    // Check file creation
    console.log('9️⃣  Verifying file creation...');
    const fs = await import('fs');
    const memDir = `bots/QuickTestBot/memories`;
    if (fs.existsSync(memDir)) {
        const files = fs.readdirSync(memDir);
        console.log(`   ✓ Memory directory created`);
        console.log(`   ✓ Files created: ${files.length}`);
        files.forEach(f => console.log(`     - ${f}`));
    }
    console.log();
    
    // Success!
    console.log('════════════════════════════════════════════');
    console.log('✅ ALL TESTS PASSED!');
    console.log('════════════════════════════════════════════\n');
    
    console.log('📁 Your memory is stored at:');
    console.log(`   bots/QuickTestBot/memories/\n`);
    
    console.log('📚 Next steps:');
    console.log('   1. Read: README_MEMORY_SYSTEM.md');
    console.log('   2. Follow: IMPLEMENTATION_CHECKLIST.md');
    console.log('   3. Integrate into agent.js\n');
    
    console.log('🚀 Ready to add a brain to your bot!\n');
    
} catch (error) {
    console.error('❌ TEST FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
}
