import { describe, it, expect } from 'vitest';
import { isHomeAssistantIngress } from '../src/ui/host';

describe('isHomeAssistantIngress', () => {
  it('recognises the path Home Assistant proxies an add-on under', () => {
    expect(isHomeAssistantIngress('/api/hassio_ingress/AbC123token/')).toBe(true);
    expect(isHomeAssistantIngress('/api/hassio_ingress/AbC123token/index.html')).toBe(true);
    expect(isHomeAssistantIngress('/api/hassio_ingress/AbC123token')).toBe(true);
  });

  it('does not treat the add-on opened on its own port as Ingress', () => {
    // Nothing else is drawing a header there, so the page keeps its own.
    expect(isHomeAssistantIngress('/')).toBe(false);
    expect(isHomeAssistantIngress('/index.html')).toBe(false);
    expect(isHomeAssistantIngress('')).toBe(false);
  });

  it('needs an actual token, not just the prefix', () => {
    expect(isHomeAssistantIngress('/api/hassio_ingress/')).toBe(false);
    expect(isHomeAssistantIngress('/api/hassio_ingress')).toBe(false);
  });

  it('only matches at the root, where Ingress actually serves', () => {
    expect(isHomeAssistantIngress('/docs/api/hassio_ingress/token/')).toBe(false);
  });

  it('reports false rather than throwing where there is no location', () => {
    expect(isHomeAssistantIngress()).toBe(false);
  });
});
