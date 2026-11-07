/**
 * App-wide settings. Every script attaches itself to the global namespace `window.Sift`.
 */
window.Sift = window.Sift || {};

Sift.config = {
  APP_VERSION: '1.0.0',
  STORAGE_PREFIX: 'sift:',
  MAX_TABLE_ROWS: 500,     // result rows drawn in the table (the JSON view has everything)
  JSON_HIGHLIGHT_MAX: 1.5 * 1024 * 1024, // bigger responses show as plain text
  DOCS_PAGE: 50,
  MAX_FROM: 10000,         // Elasticsearch's default max_result_window
};
