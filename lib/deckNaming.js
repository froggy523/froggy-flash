'use strict';

function slugifyDeckStem(name) {
  const trimmed = (name && String(name).trim()) || 'deck';
  const base = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'deck';
}

module.exports = { slugifyDeckStem };
