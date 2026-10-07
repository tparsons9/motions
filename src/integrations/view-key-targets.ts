const containers = new Set<HTMLElement>();

export function registerViewKeyTarget(container: HTMLElement): () => void {
    containers.add(container);
    return () => {
        containers.delete(container);
    };
}

/** A host routes its own DOM keys; the global capture handler must not steal them. */
export function ownsViewKeyTarget(target: EventTarget | null): boolean {
    if (!target || !('nodeType' in target)) return false;
    for (const container of containers)
        if (container.contains(target as Node)) return true;
    return false;
}
