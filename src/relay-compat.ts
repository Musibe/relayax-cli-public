#!/usr/bin/env node

// Deprecation warning for "relay" → "anpm" rebrand
process.stderr.write('\x1b[33m⚠ "relay" is now "anpm". Please use "anpm" instead.\n  This alias will be removed in a future version.\x1b[0m\n\n')

// Run the same entry point
import('./index.js')
