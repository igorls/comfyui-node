export declare class SimulatedUser {
    promptGenerator: (() => string) | null;
    modelFunction: (prompt: string) => Promise<string[]>;
    shouldGenerate: boolean;
    totalImages: number;
    collectedImages: number;
    constructor(generator?: (() => string) | null, modelFunction?: (prompt: string) => Promise<string[]>, totalImages?: number);
    stop(): void;
    start(): void;
    generateImages(count: number): Promise<void>;
}
//# sourceMappingURL=multipool-basic.d.ts.map