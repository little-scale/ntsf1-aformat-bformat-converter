#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
emcc src/ntsf1_dsp.c src/browser/analysis_stats.c src/standalone/meter.c \
 -O2 -ffp-contract=off --no-entry \
 -s STANDALONE_WASM=1 -s ALLOW_MEMORY_GROWTH=1 \
 -s INITIAL_MEMORY=16777216 -s FILESYSTEM=0 \
 -s EXPORTED_FUNCTIONS='["_malloc","_free","_rode_create","_rode_hop","_rode_process","_rode_set_orientation","_rode_match_neutral_api","_rode_destroy","_rode_frequency_covariance","_stats_create","_stats_push","_stats_get","_stats_destroy","_meter_create","_meter_push","_meter_finish","_meter_destroy"]' \
 -o src/standalone/ntsf1.wasm
