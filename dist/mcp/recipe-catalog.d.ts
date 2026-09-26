import { ComfyRecipesInput } from "./schemas.js";
export interface RecipeDefinition {
    id: string;
    name: string;
    description: string;
    category: "image" | "video" | "audio" | "3d";
    distilled: boolean;
    requiredNodes: string[];
    modelRequirements: {
        unetPatterns?: RegExp[];
        checkpointPatterns?: RegExp[];
        clipPatterns?: RegExp[];
        vaePatterns?: RegExp[];
    };
    defaultParams: {
        width: number;
        height: number;
        steps: number;
        cfg: number;
        sampler: string;
        scheduler: string;
    };
    defaultSlots: Record<string, string>;
    buildGraph: (resolvedModels: {
        unet?: string;
        checkpoint?: string;
        clip?: string;
        vae?: string;
    }, options?: {
        prompt?: string;
        negativePrompt?: string;
        width?: number;
        height?: number;
        seed?: number;
    }) => Record<string, any>;
}
export interface AvailableModels {
    unets: string[];
    checkpoints: string[];
    clips: string[];
    vaes: string[];
}
export declare const CANONICAL_RECIPES: RecipeDefinition[];
export declare class RecipeCatalog {
    private recipes;
    constructor(customRecipes?: RecipeDefinition[]);
    /**
     * Helper to match available models against regex patterns
     */
    private findMatchingModel;
    /**
     * Check if a recipe is runnable with the server's installed models
     */
    isRecipeRunnable(recipe: RecipeDefinition, availableModels: AvailableModels): {
        runnable: boolean;
        resolvedModels: {
            unet?: string;
            checkpoint?: string;
            clip?: string;
            vae?: string;
        };
        missing: string[];
    };
    /**
     * List recipes with status against installed models
     */
    list(availableModels: AvailableModels, options?: {
        category?: string;
        installedOnly?: boolean;
    }): {
        count: number;
        recipes: {
            id: string;
            name: string;
            description: string;
            category: "image" | "audio" | "video" | "3d";
            distilled: boolean;
            isRunnable: boolean;
            resolvedModels: {
                unet?: string;
                checkpoint?: string;
                clip?: string;
                vae?: string;
            };
            missingModels: string[];
            defaultParams: {
                width: number;
                height: number;
                steps: number;
                cfg: number;
                sampler: string;
                scheduler: string;
            };
            slots: string[];
        }[];
    };
    /**
     * Scaffold a ready-to-run workflow graph for a given recipe
     */
    scaffold(recipeId: string, availableModels: AvailableModels, input?: ComfyRecipesInput): {
        recipe: string;
        workflow: Record<string, any>;
        slots: Record<string, string>;
        params: Record<string, any>;
    };
}
//# sourceMappingURL=recipe-catalog.d.ts.map