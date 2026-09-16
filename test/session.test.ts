/** Tests de la session d'appareil : cookie et repli sur le localStorage. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSessionId, resolvePlayerId, SESSION_COOKIE } from '../lib/session.ts';
import type { Player } from '../lib/types.ts';

function reqWithCookie(cookie: string | null): Request {
  return new Request('https://vestiaire.test/api/state', {
    headers: cookie === null ? {} : { cookie },
  });
}

const players: Record<string, Player> = {
  'p-abc': { name: 'Virgile', level: 2, updatedAt: new Date(0).toISOString() },
  'p-def': { name: 'Léa', level: 5, updatedAt: new Date(0).toISOString() },
};

test('readSessionId : lit le cookie parmi d’autres, tolère les espaces', () => {
  assert.equal(readSessionId(reqWithCookie(`${SESSION_COOKIE}=p-abc`)), 'p-abc');
  assert.equal(readSessionId(reqWithCookie(`theme=dark; ${SESSION_COOKIE}=p-abc; x=1`)), 'p-abc');
  assert.equal(readSessionId(reqWithCookie(`  ${SESSION_COOKIE} = p-abc `)), 'p-abc');
});

test('readSessionId : absent, vide ou malformé → null', () => {
  assert.equal(readSessionId(reqWithCookie(null)), null);
  assert.equal(readSessionId(reqWithCookie('theme=dark')), null);
  assert.equal(readSessionId(reqWithCookie('justeUnMot')), null);
  // Un identifiant qui ne respecte pas le format attendu est ignoré.
  assert.equal(readSessionId(reqWithCookie(`${SESSION_COOKIE}=p abc`)), null);
  assert.equal(readSessionId(reqWithCookie(`${SESSION_COOKIE}=${'x'.repeat(65)}`)), null);
});

test('resolvePlayerId : le cookie prime, le localStorage rattrape, l’inconnu est écarté', () => {
  const state = { players };
  assert.equal(resolvePlayerId(state, 'p-abc', null), 'p-abc');
  assert.equal(resolvePlayerId(state, 'p-abc', 'p-def'), 'p-abc');
  // Cookie perdu (Safari, navigateur intégré) : le localStorage sauve la mise.
  assert.equal(resolvePlayerId(state, null, 'p-def'), 'p-def');
  // Cookie qui pointe sur un joueur disparu : on retombe sur le localStorage.
  assert.equal(resolvePlayerId(state, 'p-zzz', 'p-def'), 'p-def');
  // Les deux sont perdus ou inconnus : l'appareil n'est identifié par personne.
  assert.equal(resolvePlayerId(state, null, null), null);
  assert.equal(resolvePlayerId(state, 'p-zzz', 'p-yyy'), null);
});
