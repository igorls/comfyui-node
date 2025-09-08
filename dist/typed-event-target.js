// Lightweight strongly-typed EventTarget wrapper without exploding union overloads.
// M is a mapping of event name to CustomEvent<Detail>.
export class TypedEventTarget extends EventTarget {
    on(type, handler, options) {
        this.addEventListener(type, handler, options);
        return () => this.off(type, handler, options);
    }
    off(type, handler, options) {
        this.removeEventListener(type, handler, options);
    }
    once(type, handler, options) {
        const off = this.on(type, (ev) => { off(); handler(ev); }, { ...(typeof options === 'object' ? options : {}), once: true });
        return off;
    }
    emit(type, event) {
        this.dispatchEvent(event);
    }
}
//# sourceMappingURL=typed-event-target.js.map