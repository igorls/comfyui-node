export declare class TwoStageUser {
    private userId;
    private shouldRun;
    private totalGenerations;
    private generatedImages;
    private editsPerImage;
    private minDelayMs;
    private maxDelayMs;
    stats: {
        generationsStarted: number;
        generationsCompleted: number;
        generationsFailed: number;
        editsStarted: number;
        editsCompleted: number;
        editsFailed: number;
    };
    constructor(userId: string, options?: {
        totalGenerations?: number;
        editsPerImage?: number;
        minDelayMs?: number;
        maxDelayMs?: number;
    });
    stop(): void;
    start(): Promise<void>;
    private generationLoop;
    private editLoop;
    private generateImage;
    private editImage;
    private delay;
    private printStats;
}
//# sourceMappingURL=two-stage-edit-simulation.d.ts.map