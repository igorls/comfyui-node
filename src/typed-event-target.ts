/**
 * Lightweight strongly-typed EventTarget wrapper without exploding union overloads.
 * M is a mapping of event name to CustomEvent<Detail>.
 */
export class TypedEventTarget<M extends Record<string, CustomEvent<any>>> extends EventTarget {
  private handlerMap = new WeakMap<Function, EventListener>();

  /**
   * Adds an event listener for the specified event type.
   * @param type - The event type to listen for
   * @param handler - The event handler function
   * @param options - Event listener options
   * @returns A function to remove the event listener
   */
  on<K extends keyof M>(type: K, handler: (ev: M[K]) => void, options?: AddEventListenerOptions | boolean) {
    const wrappedHandler = (event: Event) => {
      try {
        handler(event as M[K]);
      } catch (error) {
        console.error(`Error in event handler for ${String(type)}:`, error);
      }
    };
    this.handlerMap.set(handler, wrappedHandler);
    this.addEventListener(type as string, wrappedHandler, options);
    return () => this.off(type, handler, options);
  }

  /**
   * Removes an event listener for the specified event type.
   * @param type - The event type to remove the listener for
   * @param handler - The event handler function to remove
   * @param options - Event listener options
   */
  off<K extends keyof M>(type: K, handler: (ev: M[K]) => void, options?: EventListenerOptions | boolean) {
    const wrappedHandler = this.handlerMap.get(handler);
    if (wrappedHandler) {
      this.removeEventListener(type as string, wrappedHandler, options);
      this.handlerMap.delete(handler);
    }
  }

  /**
   * Adds an event listener that will only be called once for the specified event type.
   * @param type - The event type to listen for
   * @param handler - The event handler function
   * @param options - Event listener options
   * @returns A function to remove the event listener
   */
  once<K extends keyof M>(type: K, handler: (ev: M[K]) => void, options?: AddEventListenerOptions | boolean) {
    const off = this.on(type, (ev: M[K]) => { off(); handler(ev); }, { ...(typeof options === 'object' ? options : {}), once: true });
    return off;
  }

  /**
   * Emits an event of the specified type.
   * @param type - The event type to emit
   * @param event - The event object to emit
   */
  emit<K extends keyof M>(type: K, event: M[K]) {
    this.dispatchEvent(event);
  }
}
