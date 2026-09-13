// themes/classic.js — the default theme replaces no view.
//
// It exists so the default theme never asks for a file that is not there. `theme.js` imports
// `themes/<slug>.js` when a theme is worn and tolerates its absence, but the tolerated case
// costs a 404 on every first load, and classic is what every browser wears first.
//
// This is also the shape every theme's module has. See THEMES.md § "Replacing a view".
export const views = {};
