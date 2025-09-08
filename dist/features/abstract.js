export class AbstractFeature extends EventTarget {
    client;
    supported = false;
    constructor(client) {
        super();
        this.client = client;
    }
    get isSupported() {
        return this.supported;
    }
    on(type, callback, options) {
        this.addEventListener(type, callback, options);
        return () => this.off(type, callback);
    }
    off(type, callback, options) {
        this.removeEventListener(type, callback, options);
    }
}
//# sourceMappingURL=abstract.js.map