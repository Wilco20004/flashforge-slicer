/**
 * Where this page is being shown.
 *
 * Home Assistant frames an add-on's panel under its own header, which already
 * carries the add-on's name and icon. The page's own title bar would then be
 * saying the same thing a second time, and on a phone it costs a whole row of
 * a screen that has none to spare.
 */

/**
 * True when served through Home Assistant's Ingress.
 *
 * Ingress proxies the add-on under `/api/hassio_ingress/<token>/`. The add-on's
 * nginx never sees that prefix — Home Assistant strips it before proxying — but
 * the browser's address keeps it, so this is the one place it can be read. The
 * add-on opened directly on its own port is not Ingress and keeps its title,
 * because nothing else is showing one.
 */
export function isHomeAssistantIngress(
  pathname: string = typeof location === 'undefined' ? '' : location.pathname,
): boolean {
  // Anchored: Ingress always serves from the root of the Home Assistant host,
  // so a path that merely contains those words further down is not it.
  return /^\/api\/hassio_ingress\/[^/]+/.test(pathname);
}
