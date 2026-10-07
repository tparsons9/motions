export interface MappingSource {
    path: string;
    line: number;
}
export interface MappingRecord {
    keys: string;
    mode: string;
    scope: string;
    action: string;
    description?: string;
    origin: string;
    path?: string;
    line?: number;
    buffer?: string;
    findings: string[];
}
export interface ConfigurationSnapshot {
    generation: number;
    backend: string;
    status: string;
    mappings: MappingRecord[];
    sources: { path: string; text: string }[];
    truncated: boolean;
}
export interface ConfigurationApi {
    readonly apiVersion: 1;
    definitions(): { version: string; text: string };
    snapshot(buffer?: string): ConfigurationSnapshot;
    subscribe(callback: () => void): () => void;
}
