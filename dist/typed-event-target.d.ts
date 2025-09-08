export declare class TypedEventTarget<M extends Record<string, CustomEvent<any>>> extends EventTarget {
    on<K extends keyof M>(type: K, handler: (ev: M[K]) => void, options?: AddEventListenerOptions | boolean): () => void;
    off<K extends keyof M>(type: K, handler: (ev: M[K]) => void, options?: EventListenerOptions | boolean): void;
    once<K extends keyof M>(type: K, handler: (ev: M[K]) => void, options?: AddEventListenerOptions | boolean): () => void;
    emit<K extends keyof M>(type: K, event: M[K]): void;
}
//# sourceMappingURL=typed-event-target.d.ts.map