// This module owns its native Media3 configuration in source. The postinstall
// hook intentionally does no node_modules patching, so no second player or
// network stack can be introduced through package installation.
console.log("[media3-live-tv] native Media3 configuration is source-owned");
