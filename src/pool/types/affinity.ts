export interface WorkflowAffinity {
  workflowHash: string;
  preferredClientIds?: string[];
  excludeClientIds?: string[];
}
