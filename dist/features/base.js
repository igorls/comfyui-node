export class FeatureBase {
    isSupported = false;
    client;
    constructor(client) {
        this.client = client;
    }
    destroy() {
        // Base destroy method
    }
    async checkSupported() {
        // Base checkSupported method does nothing; concrete features override.
        return this.isSupported;
    }
}
//# sourceMappingURL=base.js.map