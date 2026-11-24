import type { AutoSupportScope } from './supportScope';

export type MagicPrepareWorkflowConfig = {
    orientationEnabled: boolean;
    supportsEnabled: boolean;
    optimizeEnabled: boolean;
    bracingEnabled: boolean;
    raftEnabled: boolean;
    arrangeAfterPrepare?: boolean;
    saveProjectAfterPrepare?: boolean;
    sliceAfterPrepare?: boolean;
    supportScope: AutoSupportScope;
};

export type MagicPrepareWorkflow = MagicPrepareWorkflowConfig & {
    id: string;
    name: string;
};

export const MAGIC_PREPARE_WORKFLOWS_STORAGE_KEY = 'magic-prepare-workflows-v1';

const EMPTY_WORKFLOWS: MagicPrepareWorkflow[] = [];
const listeners = new Set<() => void>();

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeWorkflow(value: unknown): MagicPrepareWorkflow | null {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()
        || typeof value.name !== 'string' || !value.name.trim()) return null;

    return {
        id: value.id,
        name: value.name.trim().slice(0, 80),
        orientationEnabled: value.orientationEnabled === true,
        supportsEnabled: value.supportsEnabled === true,
        optimizeEnabled: value.optimizeEnabled === true,
        bracingEnabled: value.bracingEnabled === true,
        raftEnabled: value.raftEnabled === true,
        arrangeAfterPrepare: value.arrangeAfterPrepare === true,
        saveProjectAfterPrepare: value.saveProjectAfterPrepare === true,
        sliceAfterPrepare: value.sliceAfterPrepare === true,
        supportScope: value.supportScope === 'interior' || value.supportScope === 'exterior'
            ? value.supportScope
            : 'combined',
    };
}

function readStoredWorkflows(): MagicPrepareWorkflow[] {
    if (typeof localStorage === 'undefined') return EMPTY_WORKFLOWS;
    try {
        const stored = localStorage.getItem(MAGIC_PREPARE_WORKFLOWS_STORAGE_KEY);
        if (!stored) return EMPTY_WORKFLOWS;
        const parsed: unknown = JSON.parse(stored);
        if (!Array.isArray(parsed)) return EMPTY_WORKFLOWS;
        const byId = new Map<string, MagicPrepareWorkflow>();
        for (const value of parsed) {
            const workflow = normalizeWorkflow(value);
            if (workflow && !byId.has(workflow.id)) byId.set(workflow.id, workflow);
        }
        return [...byId.values()];
    } catch {
        return EMPTY_WORKFLOWS;
    }
}

let workflows = readStoredWorkflows();

function notify(): void {
    workflows = workflows.map((workflow) => ({ ...workflow }));
    listeners.forEach((listener) => listener());
}

function persist(): void {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(MAGIC_PREPARE_WORKFLOWS_STORAGE_KEY, JSON.stringify(workflows));
    } catch {
        // Keep the change available for this session when storage is unavailable.
    }
}

export function subscribeToMagicPrepareWorkflows(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getMagicPrepareWorkflowsSnapshot(): MagicPrepareWorkflow[] {
    return workflows;
}

export function getMagicPrepareWorkflowsServerSnapshot(): MagicPrepareWorkflow[] {
    return EMPTY_WORKFLOWS;
}

export function saveMagicPrepareWorkflow(name: string, config: MagicPrepareWorkflowConfig): string | null {
    const normalizedName = name.trim().slice(0, 80);
    if (!normalizedName) return null;
    const existing = workflows.find((workflow) => workflow.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase());
    const id = existing?.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const nextWorkflow = normalizeWorkflow({ ...config, id, name: normalizedName });
    if (!nextWorkflow) return null;
    workflows = existing
        ? workflows.map((workflow) => workflow.id === id ? nextWorkflow : workflow)
        : [...workflows, nextWorkflow];
    persist();
    notify();
    return id;
}

export function deleteMagicPrepareWorkflow(id: string): boolean {
    if (!workflows.some((workflow) => workflow.id === id)) return false;
    workflows = workflows.filter((workflow) => workflow.id !== id);
    persist();
    notify();
    return true;
}
