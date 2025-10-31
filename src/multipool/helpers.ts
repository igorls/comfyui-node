export function classifyFailure(error: any): { type: 'connection' | 'workflow_incompatibility' | 'transient', message: string } {
  const responseData = error?.bodyJSON || error?.response?.data;

  // Case 1: Connection Failure (no response from server)
  if (!responseData) {
    return { type: 'connection', message: error.message || 'Connection failed' };
  }

  // Case 2: Workflow Incompatibility (specific errors from ComfyUI)
  if (responseData.node_errors && Object.keys(responseData.node_errors).length > 0) {
    for (const nodeError of Object.values(responseData.node_errors) as any) {
      for (const err of nodeError.errors) {
        // Missing custom nodes
        if (err.type.includes("FileNotFoundError") || err.details?.includes("cannot be found")) {
          return { type: 'workflow_incompatibility', message: `Missing file or model: ${err.details}` };
        }
        // Missing model files (checkpoints, LoRAs, etc.) - also covers other value_not_in_list that reference files
        if (err.type === "value_not_in_list") {
          const details = err.details || "";
          // Check for common model/file input names
          if (details.includes("ckpt_name") || details.includes("lora_name") || 
              details.includes("model_name") || details.includes("vae_name") ||
              details.includes("embedding_name") || details.includes("controlnet") ||
              details.includes(".safetensors") || details.includes(".ckpt") || 
              details.includes(".pt") || details.includes(".pth")) {
            return { type: 'workflow_incompatibility', message: `Missing model file: ${details}` };
          }
        }
        // Errors during model loading
        if (err.message && (err.message.includes("KeyError: '") || err.message.includes("safetensors_load"))) {
          return { type: 'workflow_incompatibility', message: `Failed to load model: ${err.message}` };
        }
      }
    }
  }

  // Check for missing custom nodes (invalid_prompt type)
  if (responseData.error?.type === "invalid_prompt" && 
      responseData.error?.message?.includes("does not exist")) {
    return { type: 'workflow_incompatibility', message: responseData.error.message };
  }

  // Check for python exception for missing nodes
  if (responseData.exception_message && responseData.exception_message.includes("Node type not found")) {
    return { type: 'workflow_incompatibility', message: responseData.exception_message };
  }

  // Case 3: Transient Failure (OOM, invalid inputs, etc.)
  if (responseData.exception_message) {
    if (responseData.exception_message.includes("out of memory")) {
      return { type: 'transient', message: 'CUDA out of memory' };
    }
    return { type: 'transient', message: responseData.exception_message };
  }

  // Default to transient for other server-side errors
  return { type: 'transient', message: JSON.stringify(responseData) };
}