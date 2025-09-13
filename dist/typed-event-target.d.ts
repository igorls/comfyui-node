/**
 * Lightweight strongly-typed EventTarget wrapper without exploding union overloads.
 * M is a mapping of event name to CustomEvent<Detail>.
 */
export declare class TypedEventTarget<M extends Record<string, CustomEvent<any>>> extends EventTarget {
    /**
     * Adds an event listener for the specified event type.
     * @param type - The event type to listen for
     * @param handler - The event handler function
     * @param options - Event listener options
     * @returns A function to remove the event listener
     */
    on<K extends keyof M>(type: K, handler: (ev: M[K]) => void, options?: AddEventListenerOptions | boolean): () => void;
    /**
     * Removes an event listener for the specified event type.
     * @param type - The event type to remove the listener for
     * @param handler - The event handler function to remove
     * @param options - Event listener options
     */
    off<K extends keyof M>(type: K, handler: (ev: M[K]) => void, options?: EventListenerOptions | boolean): void;
    /**
     * Adds an event listener that will only be called once for the specified event type.
     * @param type - The event type to listen for
     * @param handler - The event handler function
     * @param options - Event listener options
     * @returns A function to remove the event listener
     */
    once<K extends keyof M>(type: K, handler: (ev: M[K]) => void, options?: AddEventListenerOptions | boolean): () => void;
    /**
     * Emits an event of the specified type.
     * @param type - The event type to emit
     * @param event - The event object to emit
     */
    emit<K extends keyof M>(type: K, event: M[K]): void;
}
//# sourceMappingURL=typed-event-target.d.ts.map