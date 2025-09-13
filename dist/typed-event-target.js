/**
 * Lightweight strongly-typed EventTarget wrapper without exploding union overloads.
 * M is a mapping of event name to CustomEvent<Detail>.
 */
export class TypedEventTarget extends EventTarget {
    /**
     * Adds an event listener for the specified event type.
     * @param type - The event type to listen for
     * @param handler - The event handler function
     * @param options - Event listener options
     * @returns A function to remove the event listener
     */
    on(type, handler, options) {
        this.addEventListener(type, handler, options);
        return () => this.off(type, handler, options);
    }
    /**
     * Removes an event listener for the specified event type.
     * @param type - The event type to remove the listener for
     * @param handler - The event handler function to remove
     * @param options - Event listener options
     */
    off(type, handler, options) {
        this.removeEventListener(type, handler, options);
    }
    /**
     * Adds an event listener that will only be called once for the specified event type.
     * @param type - The event type to listen for
     * @param handler - The event handler function
     * @param options - Event listener options
     * @returns A function to remove the event listener
     */
    once(type, handler, options) {
        const off = this.on(type, (ev) => { off(); handler(ev); }, { ...(typeof options === 'object' ? options : {}), once: true });
        return off;
    }
    /**
     * Emits an event of the specified type.
     * @param type - The event type to emit
     * @param event - The event object to emit
     */
    emit(type, event) {
        this.dispatchEvent(event);
    }
}
//# sourceMappingURL=typed-event-target.js.map