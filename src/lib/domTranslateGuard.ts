// Guard against the well-known crash where a browser translation feature
// (Google Translate, Safari/WebKit on-device auto-translate) rewrites the text
// nodes React is managing. React later calls removeChild/insertBefore on a node
// that no longer belongs to the parent it expects; WebKit throws
// "NotFoundError: The object can not be found here." (Chrome: "The node to be
// removed is not a child of this node.") and the whole app white-screens.
//
// Making just these two DOM calls fail-safe when the node isn't where React
// thinks it is keeps reconciliation alive instead of crashing the tab. This is
// the widely-used mitigation for the React + browser-translation issue
// (facebook/react#11538). Translation still works; the app just stops dying.
//
// Install this ONCE, before React mounts (main.tsx), so the patch is in place
// for the very first render.
export function installDomTranslateGuard(): void {
  if (typeof Node === "undefined" || !Node.prototype) return;
  const w = window as unknown as { __domTranslateGuardInstalled?: boolean };
  if (w.__domTranslateGuardInstalled) return;
  w.__domTranslateGuardInstalled = true;

  const originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      if (import.meta.env.DEV) {
        console.warn("[domTranslateGuard] removeChild: node is not a child of the expected parent — skipping", child);
      }
      return child;
    }
    return originalRemoveChild.call(this, child) as T;
  };

  const originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(this: Node, newNode: T, referenceNode: Node | null): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      if (import.meta.env.DEV) {
        console.warn("[domTranslateGuard] insertBefore: reference node is not a child of the expected parent — appending instead", referenceNode);
      }
      return originalInsertBefore.call(this, newNode, null) as T;
    }
    return originalInsertBefore.call(this, newNode, referenceNode) as T;
  };
}
