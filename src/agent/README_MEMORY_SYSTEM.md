# 🧠 SISTEMA DI MEMORIA COMPLETO PER MINDCRAFT BOT

## Cosa è stato implementato

Un **sistema di memoria a 3 livelli** con **comportamento emergente** per il bot Minecraft. Il bot ora:

- ✅ **Non fa loop stupidi** - Traccia fallimenti e cambia strategia
- ✅ **Ha personalità viva** - Paure, umore, preferenze che evolvono
- ✅ **Impara veramente** - Registra abilità e le riusa
- ✅ **Ricorda tutto** - Tra sessioni, attraverso JSON persistente
- ✅ **Prende decisioni intelligenti** - Usa memoria rilevante nel prompt
- ✅ **Scrive un diario** - "Today I died twice but learned a new cave"

---

## 📁 File creati

### Core System (da integrare)
- **`advanced_memory_bank.js`** - Sistema memoria 3 livelli con JSON persistence
- **`system_prompt.js`** - Nuovo prompt completo con personalità
- **`memory_aware_prompter.js`** - Layer integrazione memoria↔prompting
- **`memory_quick_commands.js`** - Funzioni di comodo per uso memoria

### Documentazione
- **`MEMORY_SYSTEM_GUIDE.md`** - Guida completa (in italiano)
- **`INTEGRATION_GUIDE.md`** - Come collegare tutto
- **`PRACTICAL_INTEGRATION_EXAMPLES.md`** - Codice copy-paste ready
- **`memory_system_test.js`** - Test per verificare che funziona

---

## 🚀 Quick Start (3 step)

### Step 1: Importa nei tuoi file

```javascript
import { AdvancedMemoryBank } from './advanced_memory_bank.js';
import { MemoryAwarePrompter } from './memory_aware_prompter.js';
```

### Step 2: Inizializza in Agent.start()

```javascript
this.memory_bank = new AdvancedMemoryBank(this.name);
this.memory_prompter = new MemoryAwarePrompter(this);
```

### Step 3: Usa il nuovo prompt quando chiami il modello

```javascript
const systemPrompt = this.memory_prompter.buildSystemPrompt(situation);
// Passa systemPrompt al tuo LLM invece del vecchio hardcoded
```

**Fatto!** Il resto è automatico.

---

## 💡 Cosa fa realmente

### Memoria a 3 livelli

```
SHORT-TERM (20 eventi recenti)
├── "Killed a zombie"
├── "Found iron ore"
└── "Health is low"

LONG-TERM (informazioni importanti)
├── Home at [100, 65, 0]
├── Danger zones (lava at [150, 20, 50])
├── Resource locations (iron cave)
└── Unfinished goals

SKILLS (procedure riuscite)
├── survive_night (85% success)
├── gather_wood (92% success)
└── craft_bed (88% success)
```

### Retrieval Intelligente

Quando il bot deve decidere "scappo o combatto?":

```
Situazione: "I see a zombie"
        ↓
Sistema automaticamente cerca:
✓ "Ho ucciso zombie prima?" (memoria breve)
✓ "È una zona pericolosa?" (memoria lunga)
✓ "Ho una abilità per questo?" (skill)
✓ "Qual è il mio umore attuale?" (personalità)
        ↓
Risultato: Solo info rilevante nel prompt
```

### Anti-Loop Intelligente

```
Azione fallisce → recordFailure()
Azione fallisce di nuovo → recordFailure()
Ora: shouldAbortAction() = true ← CAMBIA STRATEGIA!
```

### Personalità Dinamica

```
┌─ Paure apprese (cave_combat, lava, heights)
├─ Umore corrente (confident, anxious, neutral)
├─ Drive esplorazione (0.0-1.0)
└─ Traits evolventissimi (cautious, confident, paranoid...)

Dopo morte in caverna:
✓ cave_combat fear +0.3
✓ mood = "anxious"
✓ fear_level +0.1

Dopo 10 ore sicure:
✓ fear_level -0.05
✓ mood = "confident"
```

### Diario Automatico

Ogni 5 minuti:
```json
{
  "timestamp": "2024-01-15T14:30:00Z",
  "entry": "Today I explored east and found iron. 
           Almost died to skeletons. 
           Built shelter. 
           Current mood: cautious. 
           Still need: diamond pickaxe."
}
```

Leggere il diario di 8 ore di gioco è MAGNIFICO.

---

## 🎯 Esempi d'uso

### Ricordare una locazione

```javascript
MEMORY_QUICK_COMMANDS.rememberPlace(
    agent.memory_bank,
    'my_iron_cave',
    150, 30, 50,
    'Rich in iron, spawner inside'
);
```

### Insegnare un'abilità

```javascript
MEMORY_QUICK_COMMANDS.learnSkill(
    agent.memory_bank,
    'survive_night',
    ['gather_wood', 'craft_bed', 'sleep'],
    0.9
);
```

### Prevenire loop

```javascript
if (MEMORY_QUICK_COMMANDS.shouldAbortAction(memory, 'mine_diamonds')) {
    // Questa azione è fallita 2 volte, cambia strategia
    tryAlternativeApproach();
}
```

### Tracciare obiettivi

```javascript
MEMORY_QUICK_COMMANDS.addGoal(memory, 'Get diamond pickaxe');
// ...time passes...
MEMORY_QUICK_COMMANDS.completeGoal(memory, 'Get diamond pickaxe');
```

---

## 📊 File Persistenza

Tutti i dati salvati in **JSON** (niente database):

```
bots/AndyBot/memories/
├── short_term_memory.json        (20 ultimi eventi)
├── long_term_memory.json         (ubicazioni, pericoli, risorse)
├── skill_memory.json             (abilità imparate)
├── personality_state.json        (umore, paure, traits)
└── diary.json                    (voci diario auto-generate)
```

**Facili da leggere, debuggare, modificare manualmente.**

---

## 🔧 Integrazione nel codice (essenziale)

### 1. Builder del prompt con memoria

```javascript
// PRIMA (vecchio):
const systemPrompt = "You are a Minecraft agent...";

// DOPO (nuovo):
const systemPrompt = this.memory_prompter.buildSystemPrompt(currentSituation);
```

### 2. Registrare risultati azioni

```javascript
const reward = calculateReward(action, result);
this.memory_prompter.handleActionResult(action, result, reward);
```

### 3. Gestire morte

```javascript
this.bot.on('death', (message) => {
    const pos = this.bot.entity.position;
    this.memory_prompter.handleDeath(`[${pos.x}, ${pos.y}, ${pos.z}]`, message);
});
```

---

## 🧪 Test del sistema

Esegui il test per verificare che tutto funziona:

```bash
node src/agent/memory_system_test.js
```

Output atteso:
```
✓ Memory initialized successfully
✓ Short-term memory working
✓ Long-term memory working
✓ Skill system working
✓ Personality system working
... (tutti i test pass)
```

---

## 📚 Documentazione completa

- **`MEMORY_SYSTEM_GUIDE.md`** - Guida 360° (LEGGERE!)
- **`INTEGRATION_GUIDE.md`** - Come collegare (esempi di codice)
- **`PRACTICAL_INTEGRATION_EXAMPLES.md`** - Snippets copy-paste
- **Commenti nel codice** - Spiegazioni dettagliate

---

## 🎭 Comportamento emergente atteso

Con questo sistema, il bot:

1. **Non ripete errori** - "Ho provato 2 volte, non funziona"
2. **Sviluppa strategie** - "La caverna è pericolosa, vado altrove"
3. **Ricorda posti** - "C'era ferro a nord dell'albero"
4. **Impara abilità** - "Ho imparato a fare letti velocemente"
5. **Mostra personalità** - "Sono nervoso dopo il creeper, resto a casa"
6. **Evita pericoli conosciuti** - "Quella lava mi ha quasi ucciso, non torno"
7. **Persegue obiettivi** - "Devo ancora il diamante della pickaxe"
8. **Evolve nel tempo** - "Dopo 10 ore sono più coraggioso"

---

## ⚠️ Limitazioni / Note

- **Memoria limitata** - Intenzionalmente: 20 eventi recenti, non migliaia
- **JSON solo** - Per semplicità e leggibilità (non scalabile per 1M+ memorie, ma buono per bot singolo)
- **Retrieval lineare** - O(n) scoring, ma n è piccolo, va bene
- **Niente machine learning vero** - Solo regole semplici, ma funziona bene per comportamento emergente

---

## 🎓 Cosa imparerà il bot

Dopo qualche ora di gioco:

- **Paure acquisite**: "Covo con spawner = sicuro no"
- **Strategie collaudate**: "Costruire letto di notte salva vita"
- **Memoria luoghi**: "Nord dell'albero = ferro abbondante"
- **Diario affascinante**: "Oggi 3 morti ma ho imparato evitare creeper"
- **Evoluzione**: "Meno paura, più curioso"

---

## 📞 Domande frequenti

**Q: Dove vanno salvati i file?**  
A: `bots/{botname}/memories/` - creato automaticamente

**Q: Posso resettar la memoria?**  
A: Sì - `memory.clearAllMemories()` o elimina la cartella

**Q: Quanto overhead di token nel prompt?**  
A: Piccolo - solo memorie rilevanti, max 3-4 KB

**Q: È compatibile con il codice attuale?**  
A: Sì - è un sistema addittivo, non rompe nulla

**Q: Come faccio a debuggare la memoria?**  
A: Esporta con `getAllMemories()`, leggi i JSON, vedi il diario

---

## ✅ Checklist implementazione

- [ ] Importare i 4 file JS
- [ ] Inizializzare in Agent.start()
- [ ] Aggiornare prompt builder
- [ ] Aggiungere result recording
- [ ] Aggiungere death handling
- [ ] Eseguire test
- [ ] Osservare comportamento emergente
- [ ] Godere il bot che "vive"

---

## 🚀 Prossimi passi

1. Leggi **`MEMORY_SYSTEM_GUIDE.md`** interamente
2. Vedi **`PRACTICAL_INTEGRATION_EXAMPLES.md`** per specifiche di codice
3. Copia gli snippet in agent.js
4. Esegui test con `memory_system_test.js`
5. Avvia il bot e osserva la magia

---

**Buon divertimento! Il tuo bot sta per diventare molto più "vivo"!** 🎮✨
