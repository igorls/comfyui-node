export class MemoryQueueAdapter {
    // 🎯 MÚLTIPLAS FILAS POR CHECKPOINT para paralelismo máximo
    // Cada checkpoint tem sua própria fila FIFO
    queuesByCheckpoint = new Map();
    inFlight = new Map();
    failed = new Map();
    nextSequenceNumber = 0; // 🎯 Contador global para ordem de enfileiramento
    // 🎯 FIFO TRACKING: Rastreia último sequenceNumber dequeued por checkpoint
    // Isso permite validar FIFO corretamente: ordem de SAÍDA da fila, não de execução
    lastDequeuedByCheckpoint = new Map();
    async enqueue(payload, opts) {
        const priority = opts?.priority ?? 0;
        const availableAt = opts?.delayMs ? Date.now() + opts.delayMs : Date.now();
        const existingFlight = this.inFlight.get(payload.jobId);
        if (existingFlight) {
            // If job is re-enqueued while still marked in-flight, treat as retry (replace entry)
            this.inFlight.delete(payload.jobId);
        }
        // 🎯 DETERMINAR CHECKPOINT KEY para roteamento
        const checkpointKey = this.getCheckpointKey(payload);
        const entry = {
            payload,
            attempt: payload.attempts,
            priority,
            availableAt,
            sequenceNumber: this.nextSequenceNumber++, // 🎯 Garante ordem FIFO estrita
            checkpointKey,
        };
        // 🎯 ADICIONAR à fila específica do checkpoint
        if (!this.queuesByCheckpoint.has(checkpointKey)) {
            this.queuesByCheckpoint.set(checkpointKey, []);
        }
        const checkpointQueue = this.queuesByCheckpoint.get(checkpointKey);
        checkpointQueue.push(entry);
        // 🎯 ORDENAR a fila do checkpoint
        checkpointQueue.sort((a, b) => {
            // Primeiro ordena por prioridade (maior primeiro)
            if (a.priority !== b.priority) {
                return b.priority - a.priority;
            }
            // Depois por timestamp (mais antigo primeiro)
            if (a.availableAt !== b.availableAt) {
                return a.availableAt - b.availableAt;
            }
            // 🎯 FIFO: Se tudo for igual, usa sequenceNumber (menor primeiro)
            return a.sequenceNumber - b.sequenceNumber;
        });
    }
    // 🎯 HELPER: Extrai checkpoint key do payload
    getCheckpointKey(payload) {
        const checkpoints = this.extractCheckpoints(payload);
        if (!checkpoints || checkpoints.length === 0) {
            return "default"; // Jobs sem checkpoint específico
        }
        // Normaliza para lowercase e remove extensão
        const normalized = checkpoints[0]
            .toLowerCase()
            .replace(/\.safetensors$/, '')
            .replace(/\.ckpt$/, '');
        return normalized;
    }
    async reserve(opts) {
        const now = Date.now();
        const availableCheckpoints = opts?.availableCheckpoints || [];
        // 🎯 MÚLTIPLAS FILAS: Procura em todas as filas de checkpoints disponíveis
        // Se availableCheckpoints está vazio, procura em TODAS as filas
        const checkpointKeysToSearch = availableCheckpoints.length > 0
            ? availableCheckpoints.map(ckpt => ckpt.toLowerCase().replace(/\.safetensors$/, '').replace(/\.ckpt$/, '')).concat(['default']) // Sempre inclui jobs sem checkpoint específico
            : Array.from(this.queuesByCheckpoint.keys()); // Sem filtro = procura todas
        // 🎯 BUSCAR PRIMEIRO JOB DISPONÍVEL nas filas compatíveis
        let selectedEntry = null;
        let selectedCheckpointKey = null;
        for (const checkpointKey of checkpointKeysToSearch) {
            const queue = this.queuesByCheckpoint.get(checkpointKey);
            if (!queue || queue.length === 0)
                continue;
            const firstEntry = queue[0];
            // Pula se ainda não está disponível (delayed)
            if (firstEntry.availableAt > now)
                continue;
            // 🎯 ENCONTROU! Pega o primeiro job disponível desta fila
            selectedEntry = firstEntry;
            selectedCheckpointKey = checkpointKey;
            break;
        }
        if (!selectedEntry || !selectedCheckpointKey) {
            return null; // Nenhum job disponível em nenhuma fila compatível
        }
        // 🎯 FIFO VALIDATION: Detecta violações de ordem FIFO
        const lastSeq = this.lastDequeuedByCheckpoint.get(selectedCheckpointKey);
        if (lastSeq !== undefined && selectedEntry.sequenceNumber < lastSeq) {
            console.warn(`⚠️ FIFO VIOLATION DETECTED! Checkpoint: ${selectedCheckpointKey}, ` +
                `Job ${selectedEntry.payload.jobId} (seq=${selectedEntry.sequenceNumber}) ` +
                `dequeued AFTER job with seq=${lastSeq}`);
        }
        this.lastDequeuedByCheckpoint.set(selectedCheckpointKey, selectedEntry.sequenceNumber);
        // 🎯 REMOVER da fila e marcar como in-flight
        const queue = this.queuesByCheckpoint.get(selectedCheckpointKey);
        queue.shift(); // Remove o primeiro
        selectedEntry.dequeuedAt = now;
        selectedEntry.attempt++;
        this.inFlight.set(selectedEntry.payload.jobId, selectedEntry);
        return {
            reservationId: selectedEntry.payload.jobId,
            payload: selectedEntry.payload,
            attempt: selectedEntry.payload.attempts,
            availableAt: selectedEntry.availableAt
        };
    }
    /**
     * 🎯 Extrai checkpoints do payload do job
     * Isso permite rastrear FIFO por checkpoint individualmente
     */
    extractCheckpoints(payload) {
        const checkpoints = new Set();
        if (!payload.workflow) {
            return [];
        }
        // Extrai de workflow JSON ou objeto
        const workflow = typeof payload.workflow === 'string'
            ? JSON.parse(payload.workflow)
            : payload.workflow;
        // Percorre todos os nodes procurando checkpoint names
        for (const [_nodeId, nodeData] of Object.entries(workflow)) {
            const node = nodeData;
            if (node?.inputs) {
                const ckptName = node.inputs.ckpt_name ||
                    node.inputs.checkpoint_name ||
                    node.inputs.model_name;
                if (ckptName && typeof ckptName === 'string') {
                    checkpoints.add(ckptName);
                }
            }
        }
        return Array.from(checkpoints);
    }
    async commit(reservationId) {
        this.inFlight.delete(reservationId);
        this.failed.delete(reservationId);
    }
    async retry(reservationId, opts) {
        const entry = this.inFlight.get(reservationId);
        if (!entry) {
            return;
        }
        this.inFlight.delete(reservationId);
        entry.payload.attempts += 1;
        entry.attempt = entry.payload.attempts;
        entry.availableAt = opts?.delayMs ? Date.now() + opts.delayMs : Date.now();
        // 🎯 FIFO: NÃO muda sequenceNumber em retry! Mantém ordem original
        // 🎯 RE-ENFILEIRAR na fila do checkpoint correspondente
        const checkpointKey = entry.checkpointKey;
        if (!this.queuesByCheckpoint.has(checkpointKey)) {
            this.queuesByCheckpoint.set(checkpointKey, []);
        }
        const queue = this.queuesByCheckpoint.get(checkpointKey);
        queue.push(entry);
        // 🎯 RE-ORDENAR a fila do checkpoint
        queue.sort((a, b) => {
            // Primeiro ordena por prioridade (maior primeiro)
            if (a.priority !== b.priority) {
                return b.priority - a.priority;
            }
            // Depois por timestamp (mais antigo primeiro)
            if (a.availableAt !== b.availableAt) {
                return a.availableAt - b.availableAt;
            }
            // 🎯 FIFO: Se tudo for igual, usa sequenceNumber (menor primeiro)
            return a.sequenceNumber - b.sequenceNumber;
        });
    }
    async discard(reservationId, reason) {
        const entry = this.inFlight.get(reservationId);
        if (!entry) {
            return;
        }
        this.inFlight.delete(reservationId);
        this.failed.set(reservationId, { entry, reason });
    }
    async remove(jobId) {
        // 🎯 PROCURAR em todas as filas de checkpoint
        for (const [_checkpointKey, queue] of this.queuesByCheckpoint) {
            const waitingIdx = queue.findIndex((entry) => entry.payload.jobId === jobId);
            if (waitingIdx !== -1) {
                queue.splice(waitingIdx, 1);
                return true;
            }
        }
        if (this.inFlight.has(jobId)) {
            return false;
        }
        return this.failed.delete(jobId);
    }
    async stats() {
        // 🎯 SOMAR jobs de todas as filas de checkpoint
        let totalWaiting = 0;
        let totalDelayed = 0;
        const now = Date.now();
        for (const [_checkpointKey, queue] of this.queuesByCheckpoint) {
            totalWaiting += queue.length;
            totalDelayed += queue.filter((entry) => entry.availableAt > now).length;
        }
        return {
            waiting: totalWaiting,
            inFlight: this.inFlight.size,
            delayed: totalDelayed,
            failed: this.failed.size
        };
    }
    async shutdown() {
        // 🎯 Limpa todas as filas de checkpoint
        this.queuesByCheckpoint.clear();
        this.inFlight.clear();
        this.failed.clear();
        this.lastDequeuedByCheckpoint.clear(); // 🎯 Limpa tracking FIFO
    }
}
//# sourceMappingURL=memory.js.map