export var OSType;
(function (OSType) {
    /**
     * Unix-like operating systems
     */
    OSType["POSIX"] = "posix";
    /**
     * Windows operating systems
     */
    OSType["NT"] = "nt";
    /**
     * Java virtual machine
     */
    OSType["JAVA"] = "java";
})(OSType || (OSType = {}));
// ============================================================================
// Jobs API Types (ComfyUI v0.6.0+)
// ============================================================================
/**
 * Job status constants matching ComfyUI's JobStatus
 * @since ComfyUI v0.6.0
 */
export var JobStatus;
(function (JobStatus) {
    JobStatus["PENDING"] = "pending";
    JobStatus["IN_PROGRESS"] = "in_progress";
    JobStatus["COMPLETED"] = "completed";
    JobStatus["FAILED"] = "failed";
})(JobStatus || (JobStatus = {}));
//# sourceMappingURL=api.js.map