// Lightweight strongly-typed EventTarget wrapper without exploding union overloads.
// M is a mapping of event name to CustomEvent<Detail>.
export class TypedEventTarget<M extends Record<string, CustomEvent<any>>> extends EventTarget {
  on<K extends keyof M>(type: K, handler: (ev: M[K]) => void, options?: AddEventListenerOptions | boolean) {
    this.addEventListener(type as string, handler as EventListener, options);
    return () => this.off(type, handler, options);
  }
  off<K extends keyof M>(type: K, handler: (ev: M[K]) => void, options?: EventListenerOptions | boolean) {
    this.removeEventListener(type as string, handler as EventListener, options);
  }
  once<K extends keyof M>(type: K, handler: (ev: M[K]) => void, options?: AddEventListenerOptions | boolean) {
    const off = this.on(type, (ev: M[K]) => { off(); handler(ev); }, { ...(typeof options === 'object' ? options : {}), once: true });
    return off;
  }
  emit<K extends keyof M>(type: K, event: M[K]) {
    this.dispatchEvent(event);
  }
}
