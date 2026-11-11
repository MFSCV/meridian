const fields = ['theme', 'locale', 'look', 'hidden', 'panelWidth', 'favoriteIntervals', 'layout', 'active', 'charts',
  'panel', 'watchlist', 'watchFolders', 'watchLocations', 'alerts', 'drawings', 'saved', 'settings', 'pvsraVersion'];
const preferences = ['tz', 'grid', 'magnet', 'keep', 'lock', 'hide', 'syncSymbol', 'syncInterval', 'syncCross',
  'live', 'feed', 'priceLine', 'legend', 'crosshair', 'drawColor', 'drawWidth', 'panelSide', 'tools', 'bottom'];
const select = (source, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(source, key)).map(key => [key, source[key]]));

// Scope the account snapshot to workspace configuration. Trading state stays on the device.
export function workspaceData(source) {
  const data = select(source, fields);
  if (data.settings) data.settings = select(data.settings, preferences);
  return data;
}
