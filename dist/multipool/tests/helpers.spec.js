import { describe, it, expect } from "bun:test";
import { classifyFailure } from "../helpers.js";
describe("classifyFailure", () => {
    // Test for Connection Failure
    it("should classify connection errors", () => {
        const connectionError = new Error("Connection timed out");
        expect(classifyFailure(connectionError)).toEqual({
            type: "connection",
            message: "Connection timed out",
        });
        const anotherConnectionError = { message: "connect ECONNREFUSED 127.0.0.1:8188" };
        expect(classifyFailure(anotherConnectionError)).toEqual({
            type: "connection",
            message: "connect ECONNREFUSED 127.0.0.1:8188",
        });
    });
    // Test for Workflow Incompatibility - Missing Model
    it("should classify missing model errors as workflow_incompatibility", () => {
        const missingModelError = {
            bodyJSON: {
                node_errors: {
                    "2": {
                        errors: [
                            {
                                type: "value_not_in_list",
                                details: "Value not in list: ckpt_name 'this_model_does_not_exist.safetensors' not in [...]",
                            },
                        ],
                    },
                },
            },
        };
        const classification = classifyFailure(missingModelError);
        expect(classification.type).toBe("workflow_incompatibility");
        expect(classification.message).toContain("Missing model file");
    });
    // Test for Workflow Incompatibility - Missing Custom Node
    it("should classify missing custom node errors as workflow_incompatibility", () => {
        const missingNodeError = {
            bodyJSON: {
                error: {
                    type: "invalid_prompt",
                    message: "Node type not found: NonExistentNode",
                },
                node_errors: {},
            },
        };
        const classification = classifyFailure(missingNodeError);
        expect(classification.type).toBe("workflow_incompatibility");
    });
    it('should classify python exception for missing nodes as workflow_incompatibility', () => {
        const pythonError = {
            bodyJSON: {
                "exception_type": "Exception",
                "exception_message": "Node type not found: ImpactWildcardEncode",
                "traceback": "..."
            }
        };
        const classification = classifyFailure(pythonError);
        expect(classification.type).toBe('workflow_incompatibility');
        expect(classification.message).toBe('Node type not found: ImpactWildcardEncode');
    });
    // Test for Transient Failure - Out of Memory
    it("should classify OOM errors as transient", () => {
        const oomError = {
            bodyJSON: {
                exception_message: "CUDA out of memory. Tried to allocate...",
            },
        };
        expect(classifyFailure(oomError)).toEqual({
            type: "transient",
            message: "CUDA out of memory",
        });
    });
    // Test for Transient Failure - Other exceptions
    it("should classify other exceptions as transient", () => {
        const genericError = {
            bodyJSON: {
                exception_message: "Something else went wrong",
            },
        };
        expect(classifyFailure(genericError)).toEqual({
            type: "transient",
            message: "Something else went wrong",
        });
    });
    // Test for Default Case
    it("should default to transient for unknown errors with a response body", () => {
        const unknownError = {
            bodyJSON: {
                some_unusual_error: "details here",
            },
        };
        expect(classifyFailure(unknownError)).toEqual({
            type: "transient",
            message: '{"some_unusual_error":"details here"}',
        });
    });
});
//# sourceMappingURL=helpers.spec.js.map