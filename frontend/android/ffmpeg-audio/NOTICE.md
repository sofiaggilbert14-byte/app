# Media3 FFmpeg audio extension

This module contains the Apache-2.0 AndroidX Media3 FFmpeg decoder wrapper
sources from AndroidX Media 1.8.0.

The build script fetches FFmpeg 6.0 and enables a limited audio-decoder set:
AAC, AC-3, E-AC-3, DTS (`dca`), TrueHD/MLP, MP3, Opus, Vorbis, FLAC, ALAC,
AMR, and G.711 PCM.

The script intentionally does not enable FFmpeg GPL components. FFmpeg is
normally LGPL-2.1-or-later in that configuration, but distributing static
native builds can carry source-offer/relinking obligations. Dolby/DTS codec
patent and certification requirements may also apply in particular territories.
Obtain appropriate legal review before shipping a commercial build.
